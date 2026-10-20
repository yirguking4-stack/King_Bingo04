'use strict';
/**
 * KING DAMA — matchmaking, wallet movements, authoritative timers and realtime push.
 *
 * Source of truth = PostgreSQL (dama_* tables). Every state change runs in ONE transaction that
 * locks the room row (SELECT … FOR UPDATE): a double click, a late timer or a second server can
 * never apply the same action twice. In-memory data = sockets + setTimeout handles only; all of it
 * is rebuilt from the database after a restart (init()).
 *
 * Money (existing wallets/transactions tables; whole ETB integers, never floats):
 *   - GAME_ENTRY when a player takes a seat (this IS the stake reservation: funds leave the
 *     spendable balance immediately and are tracked by the room).
 *   - GAME_REFUND when the search expires / is cancelled / the match is drawn / voided by an admin.
 *   - PRIZE exactly once when a decisive game ends: pot - 10% commission. Draw = full refund, no commission.
 *   - Settlement is guarded by dama_rooms.settled + the room row lock => no duplicate payout/commission.
 */
const crypto = require('crypto');
const { query, withTransaction } = require('../config/db');
const E = require('./damaEngine');
const SCHEMA = require('./damaSchema');
const { maskUsername } = require('../utils/validators');
const { unlockBonusAfterFirstGame } = require('../models/walletModel');
const { notifyDamaPrize, notifyDamaRefund } = require('./damaNotify');
const { payoutFor, COMMISSION_PERCENT } = require('./damaMoney');

const DEFAULT_BETS = [50, 70, 100, 200, 500, 1000, 5000];
const TURN_OPTIONS = [15, 30, 45, 60];
const DEFAULT_TURN_S = 45;
const DEFAULT_WAIT_S = 120;
const SWEEP_MS = 10 * 1000;
const ACTION_GAP_MS = 150;

class DamaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.userMessage = message;
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');

class DamaManager {
  constructor() {
    this.timers = new Map();
    this.roomSockets = new Map();
    this.ready = null;
    this.sweeper = null;
  }

  // ------------------------------------------------------------------ settings (admin_settings table)
  async settings() {
    const res = await query(`SELECT key, value FROM admin_settings WHERE key LIKE 'dama_%'`);
    const m = Object.fromEntries(res.rows.map((r) => [r.key, r.value]));
    let bets = (m.dama_bets || '').split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0);
    if (!bets.length) bets = DEFAULT_BETS;
    let turn = parseInt(m.dama_turn_seconds, 10);
    if (!TURN_OPTIONS.includes(turn)) turn = DEFAULT_TURN_S;
    let wait = parseInt(m.dama_wait_seconds, 10);
    if (!(wait >= 15 && wait <= 900)) wait = DEFAULT_WAIT_S;
    return { bets, turnSeconds: turn, waitSeconds: wait, majority: m.dama_majority === 'true', enabled: m.dama_enabled !== 'false' };
  }

  async saveSettings(adminId, input) {
    const out = {};
    if (input.bets !== undefined) {
      const bets = [...new Set((Array.isArray(input.bets) ? input.bets : []).map((n) => parseInt(n, 10)))].filter((n) => Number.isInteger(n) && n >= 10 && n <= 100000).sort((a, b) => a - b);
      if (!bets.length) throw new DamaError('BAD_INPUT', 'ቢያንስ አንድ የውርርድ መጠን ያስፈልጋል');
      out.dama_bets = bets.join(',');
    }
    if (input.turnSeconds !== undefined) {
      if (!TURN_OPTIONS.includes(Number(input.turnSeconds))) throw new DamaError('BAD_INPUT', `turnSeconds must be one of ${TURN_OPTIONS.join(', ')}`);
      out.dama_turn_seconds = String(Number(input.turnSeconds));
    }
    if (input.waitSeconds !== undefined) {
      const w = Number(input.waitSeconds);
      if (!(w >= 15 && w <= 900)) throw new DamaError('BAD_INPUT', 'waitSeconds must be 15..900');
      out.dama_wait_seconds = String(Math.floor(w));
    }
    if (input.majority !== undefined) out.dama_majority = input.majority ? 'true' : 'false';
    if (input.enabled !== undefined) out.dama_enabled = input.enabled ? 'true' : 'false';
    for (const [k, v] of Object.entries(out)) {
      await query(`INSERT INTO admin_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [k, v]);
    }
    await query(`INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata) VALUES ($1, 'DAMA_SETTINGS_CHANGED', 'dama', NULL, $2)`, [adminId, JSON.stringify(out)]);
    return this.settings();
  }

  // ------------------------------------------------------------------ startup / timers
  init() {
    if (!this.ready) {
      this.ready = (async () => {
        await query(SCHEMA);
        await this.recoverAfterRestart();
        this.sweeper = setInterval(() => this.sweep().catch((e) => console.error('[dama] sweep', e.message)), SWEEP_MS);
        this.sweeper.unref();
      })().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  /**
   * Restart/outage policy: deadlines are persisted, so timers are simply rebuilt. A turn deadline that
   * already passed WHILE THE SERVER WAS DOWN is a platform failure, not the player's fault: the turn
   * gets a fresh full timer (logged as OUTAGE_GRACE) instead of a timeout loss.
   */
  async recoverAfterRestart() {
    const live = await query(`SELECT id, room_code, status, wait_deadline, state FROM dama_rooms WHERE status IN ('WAITING','IN_PROGRESS')`);
    for (const r of live.rows) {
      if (r.status === 'IN_PROGRESS' && r.state && r.state.deadline && r.state.deadline <= Date.now()) {
        r.state.deadline = Date.now() + r.state.turnMs;
        await query('UPDATE dama_rooms SET state = $2 WHERE id = $1', [r.id, JSON.stringify(r.state)]);
        await this.logEvent(r.id, null, 'OUTAGE_GRACE', { newDeadline: r.state.deadline });
      }
      this.schedule(r.room_code, this.deadlineOf(r));
    }
    console.log(`[dama] ready, ${live.rowCount} live room(s) restored`);
  }

  deadlineOf(row) {
    if (row.status === 'WAITING') return row.wait_deadline ? new Date(row.wait_deadline).getTime() : null;
    if (row.status === 'IN_PROGRESS') return row.state && row.state.deadline ? row.state.deadline : null;
    return null;
  }

  schedule(code, atMs) {
    const old = this.timers.get(code);
    if (old) clearTimeout(old);
    this.timers.delete(code);
    if (!atMs) return;
    const t = setTimeout(() => {
      this.timers.delete(code);
      this.onTimer(code).catch((e) => console.error('[dama] timer', code, e.message));
    }, Math.max(0, atMs - Date.now()) + 40);
    t.unref();
    this.timers.set(code, t);
  }

  async sweep() {
    const res = await query(
      `SELECT room_code FROM dama_rooms
       WHERE (status = 'WAITING' AND wait_deadline <= now())
          OR (status = 'IN_PROGRESS' AND (state->>'deadline')::bigint <= $1)`,
      [Date.now() - 1000]
    );
    for (const r of res.rows) await this.onTimer(r.room_code);
  }

  async onTimer(code) {
    const res = await query('SELECT status FROM dama_rooms WHERE room_code = $1', [code]);
    if (!res.rowCount) return;
    if (res.rows[0].status === 'WAITING') await this.expireRoom(code);
    else if (res.rows[0].status === 'IN_PROGRESS') await this.processTimeout(code);
  }

  // ------------------------------------------------------------------ wallet helpers (inside a tx)
  async charge(client, userId, amount, code) {
    const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (!w.rowCount) throw new DamaError('NO_WALLET', 'Wallet አልተገኘም');
    const before = Number(w.rows[0].balance);
    if (before < amount) throw new DamaError('INSUFFICIENT_BALANCE', 'ቀሪ ሂሳብዎ (ETB) ለመግባት በቂ አይደለም');
    const after = before - amount;
    await client.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE user_id = $1', [userId, after]);
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status, reference_note)
       VALUES ($1, 'GAME_ENTRY', $2, $3, $4, 'COMPLETED', $5)`,
      [userId, amount, before, after, `DAMA:${code}`]
    );
  }

  async credit(client, userId, amount, type, code) {
    const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    const before = Number(w.rows[0].balance);
    const after = before + amount;
    await client.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE user_id = $1', [userId, after]);
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status, reference_note)
       VALUES ($1, $2, $3, $4, $5, 'COMPLETED', $6)`,
      [userId, type, amount, before, after, `DAMA:${code}`]
    );
  }

  async logEvent(roomId, userId, kind, detail) {
    try {
      await query('INSERT INTO dama_events (room_id, user_id, kind, detail) VALUES ($1, $2, $3, $4)', [roomId || null, userId || null, kind, detail ? JSON.stringify(detail) : null]);
    } catch (e) {
      console.error('[dama] logEvent', e.message);
    }
  }

  // ------------------------------------------------------------------ matchmaking
  /**
   * Search for an opponent with the SAME stake. One transaction, serialised per stake (advisory lock):
   *   1. lock my wallet row  -> two taps of the same user can never reserve twice
   *   2. refuse if I already sit in a WAITING / IN_PROGRESS room (no duplicate queue entry)
   *   3. join the oldest waiting room of this stake, otherwise open a new one (stake reserved either way)
   */
  async playNow(userId, { bet }) {
    const cfg = await this.settings();
    bet = Number(bet);
    if (!cfg.enabled) throw new DamaError('DISABLED', 'King Dama ለጊዜው ተዘግቷል');
    if (!Number.isInteger(bet) || !cfg.bets.includes(bet)) throw new DamaError('BAD_INPUT', 'የውርርድ መጠን ልክ አይደለም');

    let code;
    let started = false;
    await withTransaction(async (client) => {
      await client.query('SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
      const mine = await client.query(
        `SELECT r.room_code, r.status, r.bet_amount FROM dama_rooms r JOIN dama_players p ON p.room_id = r.id
         WHERE p.user_id = $1 AND p.status = 'ACTIVE' AND r.status IN ('WAITING','IN_PROGRESS') LIMIT 1`,
        [userId]
      );
      if (mine.rowCount) {
        const m = mine.rows[0];
        if (m.status === 'WAITING' && Number(m.bet_amount) === bet) { code = m.room_code; return; }
        throw new DamaError('ALREADY_IN_GAME', m.status === 'WAITING' ? 'አስቀድመው ሌላ ፍለጋ ላይ ነዎት። መጀመሪያ ይሰርዙት።' : 'በሂደት ላይ ያለ ጨዋታ አለዎት');
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dama_queue_${bet}`]);
      const open = await client.query(
        `SELECT * FROM dama_rooms r WHERE r.status = 'WAITING' AND r.wait_deadline > now() AND r.bet_amount = $1
           AND (SELECT COUNT(*) FROM dama_players p WHERE p.room_id = r.id) < 2
           AND NOT EXISTS (SELECT 1 FROM dama_players p WHERE p.room_id = r.id AND p.user_id = $2)
         ORDER BY r.created_at ASC LIMIT 1 FOR UPDATE`,
        [bet, userId]
      );
      if (open.rowCount) {
        const room = open.rows[0];
        await this.charge(client, userId, bet, room.room_code);
        await client.query('INSERT INTO dama_players (room_id, user_id, stake_paid) VALUES ($1, $2, $3)', [room.id, userId, bet]);
        await this.startGame(client, room, cfg);
        code = room.room_code;
        started = true;
        return;
      }
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const c = genCode();
        const ins = await client.query(
          `INSERT INTO dama_rooms (room_code, creator_id, bet_amount, wait_deadline) VALUES ($1, $2, $3, $4) ON CONFLICT (room_code) DO NOTHING RETURNING *`,
          [c, userId, bet, new Date(Date.now() + cfg.waitSeconds * 1000)]
        );
        if (ins.rowCount) {
          await this.charge(client, userId, bet, c);
          await client.query('INSERT INTO dama_players (room_id, user_id, stake_paid) VALUES ($1, $2, $3)', [ins.rows[0].id, userId, bet]);
          code = c;
          return;
        }
      }
      throw new DamaError('BUSY', 'እባክዎ እንደገና ይሞክሩ');
    });
    await this.afterChange(code);
    return { code, started };
  }

  /** Cancel Search: only while WAITING. The reserved stake goes back, no commission. */
  async cancelSearch(userId, code) {
    const after = [];
    await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM dama_rooms WHERE room_code = $1 FOR UPDATE', [code]);
      if (!r.rowCount) throw new DamaError('NOT_FOUND', 'ክፍሉ አልተገኘም');
      const room = r.rows[0];
      if (room.status !== 'WAITING') throw new DamaError('STARTED', 'ጨዋታው ተጀምሯል፤ ፍለጋውን መሰረዝ አይቻልም');
      const p = await client.query('DELETE FROM dama_players WHERE room_id = $1 AND user_id = $2 RETURNING stake_paid', [room.id, userId]);
      if (!p.rowCount) throw new DamaError('NOT_PLAYER', 'በዚህ ክፍል ውስጥ የሉም');
      const stake = Number(p.rows[0].stake_paid);
      await this.credit(client, userId, stake, 'GAME_REFUND', code);
      after.push(() => notifyDamaRefund(userId, stake, 'ፍለጋ ተሰርዟል፤ ክፍያዎ ተመልሷል'));
      await client.query(`UPDATE dama_rooms SET status = 'CANCELLED', end_reason = 'CANCELLED_BY_PLAYER', ended_at = now() WHERE id = $1`, [room.id]);
    });
    after.forEach((fn) => fn());
    await this.afterChange(code);
  }

  /** The waiting time ran out: refund, no commission, room closes. Idempotent (status check under lock). */
  async expireRoom(code) {
    const after = [];
    const done = await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM dama_rooms WHERE room_code = $1 FOR UPDATE', [code]);
      if (!r.rowCount) return false;
      const room = r.rows[0];
      if (room.status !== 'WAITING' || new Date(room.wait_deadline).getTime() > Date.now()) return false;
      const players = await client.query('SELECT user_id, stake_paid FROM dama_players WHERE room_id = $1', [room.id]);
      for (const p of players.rows) {
        const stake = Number(p.stake_paid);
        await this.credit(client, p.user_id, stake, 'GAME_REFUND', code);
        after.push(() => notifyDamaRefund(p.user_id, stake, 'ተጋጣሚ አልተገኘም፤ ክፍያዎ ተመልሷል'));
      }
      await client.query(`UPDATE dama_players SET status = 'LEFT' WHERE room_id = $1`, [room.id]);
      await client.query(`UPDATE dama_rooms SET status = 'CANCELLED', end_reason = 'EXPIRED', ended_at = now() WHERE id = $1`, [room.id]);
      return true;
    });
    after.forEach((fn) => fn());
    if (done) await this.afterChange(code);
  }

  // ------------------------------------------------------------------ game start / actions
  async startGame(client, room, cfg) {
    const players = await client.query('SELECT user_id FROM dama_players WHERE room_id = $1 ORDER BY joined_at, id', [room.id]);
    const flip = crypto.randomInt(2) === 1;
    const ids = players.rows.map((p) => String(p.user_id));
    const sides = flip ? [ids[1], ids[0]] : ids; // sides[0] = white (moves first)
    const state = E.createGame(Date.now(), { turnMs: cfg.turnSeconds * 1000, majority: cfg.majority });
    state.players = sides;
    state.sides = sides;
    for (let side = 0; side < 2; side += 1) {
      await client.query('UPDATE dama_players SET side = $3 WHERE room_id = $1 AND user_id = $2', [room.id, sides[side], side]);
      await unlockBonusAfterFirstGame(client, sides[side]);
    }
    const { pot } = payoutFor(Number(room.bet_amount));
    await client.query(
      `UPDATE dama_rooms SET status = 'IN_PROGRESS', state = $2, started_at = now(), wait_deadline = NULL, pot_total = $3, commission_taken = 0 WHERE id = $1`,
      [room.id, JSON.stringify(state), pot]
    );
  }

  /** Called inside the action transaction when the engine reports the game is over. Settles exactly once. */
  async settle(client, room, state, after) {
    const fresh = await client.query('SELECT settled FROM dama_rooms WHERE id = $1', [room.id]);
    if (fresh.rows[0].settled) return; // duplicate settlement protection
    const bet = Number(room.bet_amount);
    const players = await client.query('SELECT user_id, stake_paid FROM dama_players WHERE room_id = $1', [room.id]);
    if (state.draw) {
      for (const p of players.rows) {
        await this.credit(client, p.user_id, Number(p.stake_paid), 'GAME_REFUND', room.room_code);
        after.push(() => notifyDamaRefund(p.user_id, Number(p.stake_paid), 'ጨዋታው አቻ ሆነ፤ ክፍያዎ ሙሉ በሙሉ ተመልሷል'));
      }
      await client.query(
        `UPDATE dama_rooms SET status = 'FINISHED', is_draw = TRUE, prize = 0, commission_taken = 0, end_reason = $2, ended_at = now(), settled = TRUE WHERE id = $1`,
        [room.id, state.endReason]
      );
      return;
    }
    const winnerUserId = Number(state.players[state.winnerSide]);
    const { pot, commission, prize } = payoutFor(bet);
    await this.credit(client, winnerUserId, prize, 'PRIZE', room.room_code);
    after.push(() => notifyDamaPrize(winnerUserId, prize));
    await client.query('UPDATE dama_players SET is_winner = TRUE, prize = $3 WHERE room_id = $1 AND user_id = $2', [room.id, winnerUserId, prize]);
    await client.query(
      `UPDATE dama_rooms SET status = 'FINISHED', winner_user_id = $2, prize = $3, commission_taken = $4, pot_total = $5, end_reason = $6, ended_at = now(), settled = TRUE WHERE id = $1`,
      [room.id, winnerUserId, prize, commission, pot, state.endReason]
    );
  }

  /** One engine step under the room lock. `step(state, now)` returns events or null. */
  async runLocked(code, step) {
    const after = [];
    const out = await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM dama_rooms WHERE room_code = $1 FOR UPDATE', [code]);
      if (!r.rowCount) throw new DamaError('NOT_FOUND', 'ክፍሉ አልተገኘም');
      const room = r.rows[0];
      if (room.status !== 'IN_PROGRESS' || !room.state) return { events: null, room };
      const state = room.state;
      const events = step(state, Date.now(), room);
      if (!events) return { events: null, room };
      await client.query('UPDATE dama_rooms SET state = $2 WHERE id = $1', [room.id, JSON.stringify(state)]);
      for (const ev of events) {
        const uid = state.players[ev.side] ? Number(state.players[ev.side]) : null;
        const kind = ev.type === 'moved' ? 'MOVE' : ev.type === 'timeout' ? 'TIMEOUT' : 'RESIGN';
        await client.query(
          `INSERT INTO dama_moves (room_id, move_no, user_id, side, kind, from_sq, to_sq, captured, promoted) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [room.id, state.moveNo, uid, ev.side, kind, ev.from ?? null, ev.to ?? null, ev.captured ?? null, !!ev.promoted]
        );
      }
      if (state.phase === 'DONE') await this.settle(client, room, state, after);
      return { events, room, state };
    });
    after.forEach((fn) => fn());
    return out;
  }

  sideOf(state, userId) {
    const i = state.players.findIndex((u) => String(u) === String(userId));
    return i === -1 ? null : i;
  }

  async moveAction(userId, code, from, to, moveNo) {
    let rejected = null;
    let expired = false;
    let result;
    try {
      result = await this.runLocked(code, (state, now, room) => {
        const side = this.sideOf(state, userId);
        if (side === null) throw new DamaError('NOT_PLAYER', 'በዚህ ጨዋታ ውስጥ አይደሉም');
        if (state.turn !== side) throw new DamaError('NOT_YOUR_TURN', 'የእርስዎ ተራ አይደለም');
        if (Number.isInteger(moveNo) && moveNo !== state.moveNo) throw new DamaError('STALE', 'ሰሌዳው ተቀይሯል፤ እየተዘመነ ነው');
        // deterministic race rule: the server clock at lock time vs the persisted deadline
        if (state.deadline && now >= state.deadline) {
          expired = true;
          throw new DamaError('STALE', 'ጊዜው አልፏል');
        }
        try {
          return [E.applyMove(state, side, from, to, now)];
        } catch (e) {
          rejected = { room, message: e.message };
          throw new DamaError('ILLEGAL', 'ይህ እርምጃ አይፈቀድም (ግዴታ መብላት ካለ መብላት አለብዎት)');
        }
      });
    } catch (e) {
      if (rejected) await this.logEvent(rejected.room.id, userId, 'ILLEGAL_MOVE', { from, to, reason: rejected.message });
      if (expired) await this.processTimeout(code);
      throw e;
    }
    if (!result.events) throw new DamaError('NOT_ACTIVE', 'ጨዋታው አልተጀመረም ወይም አብቅቷል');
    await this.afterChange(code, result.events);
  }

  async resignAction(userId, code) {
    const result = await this.runLocked(code, (state) => {
      const side = this.sideOf(state, userId);
      if (side === null) throw new DamaError('NOT_PLAYER', 'በዚህ ጨዋታ ውስጥ አይደሉም');
      const ev = E.resign(state, side);
      return ev ? [ev] : null;
    });
    if (!result.events) throw new DamaError('NOT_ACTIVE', 'ጨዋታው አልተጀመረም ወይም አብቅቷል');
    await this.afterChange(code, result.events);
  }

  async processTimeout(code) {
    const result = await this.runLocked(code, (state, now) => {
      const ev = E.handleTimeout(state, now);
      return ev ? [ev] : null;
    });
    if (result.events) await this.afterChange(code, result.events);
    else if (result.room && result.room.status === 'IN_PROGRESS') this.schedule(code, this.deadlineOf(result.room)); // woke early
  }

  /** Admin: verified platform failure -> void the match, refund everybody, NO commission. */
  async adminVoid(adminId, code, reason) {
    const after = [];
    await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM dama_rooms WHERE room_code = $1 FOR UPDATE', [code]);
      if (!r.rowCount) throw new DamaError('NOT_FOUND', 'ክፍሉ አልተገኘም');
      const room = r.rows[0];
      if (!['WAITING', 'IN_PROGRESS'].includes(room.status) || room.settled) throw new DamaError('CLOSED', 'ይህ ጨዋታ አስቀድሞ ተጠናቋል');
      const players = await client.query('SELECT user_id, stake_paid FROM dama_players WHERE room_id = $1', [room.id]);
      for (const p of players.rows) {
        await this.credit(client, p.user_id, Number(p.stake_paid), 'GAME_REFUND', code);
        after.push(() => notifyDamaRefund(p.user_id, Number(p.stake_paid), 'ጨዋታው በሲስተም ችግር ምክንያት ተሰርዟል፤ ክፍያዎ ተመልሷል'));
      }
      const st = room.state ? { ...room.state, phase: 'DONE', endReason: 'VOID', draw: true, deadline: null } : null;
      await client.query(
        `UPDATE dama_rooms SET status = 'CANCELLED', end_reason = 'VOID', is_draw = FALSE, settled = TRUE, state = $2, ended_at = now(), prize = 0, commission_taken = 0 WHERE id = $1`,
        [room.id, st ? JSON.stringify(st) : null]
      );
      await client.query(`INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata) VALUES ($1, 'DAMA_MATCH_VOIDED', 'dama_room', $2, $3)`, [adminId, String(room.id), JSON.stringify({ code, reason: reason || null })]);
    });
    after.forEach((fn) => fn());
    await this.afterChange(code);
  }

  // ------------------------------------------------------------------ views
  async loadRoom(code) {
    const r = await query('SELECT * FROM dama_rooms WHERE room_code = $1', [code]);
    if (!r.rowCount) return null;
    const room = r.rows[0];
    const p = await query(
      `SELECT p.user_id, p.side, p.status, p.is_winner, p.prize, u.user_id_5d, u.username
       FROM dama_players p JOIN users u ON u.id = p.user_id WHERE p.room_id = $1 ORDER BY p.joined_at, p.id`,
      [room.id]
    );
    return { room, players: p.rows };
  }

  connectedUserIds(code) {
    const set = this.roomSockets.get(code);
    return new Set(set ? [...set].map((ws) => String(ws.damaUserId)) : []);
  }

  buildState(room, players, cfg) {
    const bet = Number(room.bet_amount);
    const st = room.state;
    const connected = this.connectedUserIds(room.room_code);
    const { pot, commission, prize } = payoutFor(bet);
    const view = {
      code: room.room_code,
      bet,
      pot,
      commission,
      prize,
      commissionPercent: COMMISSION_PERCENT,
      status: room.status,
      endReason: room.end_reason,
      isDraw: room.is_draw || !!(st && st.draw),
      waitDeadline: room.status === 'WAITING' && room.wait_deadline ? new Date(room.wait_deadline).getTime() : null,
      waitSeconds: cfg.waitSeconds,
      serverNow: Date.now(),
      paid: room.status === 'FINISHED' ? Number(room.prize) : null,
      players: players.map((p) => ({
        userId5d: p.user_id_5d,
        name: `@${maskUsername(p.username)}`,
        side: p.side,
        connected: connected.has(String(p.user_id)),
        winner: !!p.is_winner,
      })),
      game: null,
    };
    if (st) {
      const legal = E.legalByFrom(st);
      view.game = {
        board: st.board,
        turn: st.turn,
        chain: st.chain,
        pending: st.pending,
        legal,
        mustCapture: Object.values(legal).some((list) => list.some((m) => m.captured !== null)),
        deadline: st.deadline,
        turnSeconds: st.turnMs / 1000,
        moveNo: st.moveNo,
        phase: st.phase,
        winnerSide: st.winnerSide,
        counts: E.counts(st.board),
      };
    }
    return view;
  }

  async publicState(code) {
    const loaded = await this.loadRoom(code);
    return loaded ? this.buildState(loaded.room, loaded.players, await this.settings()) : null;
  }

  async myActive(userId) {
    const res = await query(
      `SELECT r.room_code, r.status, r.bet_amount FROM dama_rooms r JOIN dama_players p ON p.room_id = r.id
       WHERE p.user_id = $1 AND r.status IN ('WAITING','IN_PROGRESS') AND p.status = 'ACTIVE' ORDER BY r.created_at DESC LIMIT 5`,
      [userId]
    );
    return res.rows.map((r) => ({ code: r.room_code, status: r.status, bet: Number(r.bet_amount) }));
  }

  /** Player history with an understandable settlement breakdown. */
  async history(userId) {
    const res = await query(
      `SELECT r.room_code, r.status, r.bet_amount, r.pot_total, r.commission_taken, r.prize, r.is_draw, r.end_reason, r.started_at, r.ended_at,
              p.is_winner, p.stake_paid, p.prize AS my_prize, o.username AS opp_name
       FROM dama_rooms r JOIN dama_players p ON p.room_id = r.id
       LEFT JOIN dama_players op ON op.room_id = r.id AND op.user_id <> p.user_id
       LEFT JOIN users o ON o.id = op.user_id
       WHERE p.user_id = $1 AND r.status IN ('FINISHED','CANCELLED') ORDER BY r.ended_at DESC NULLS LAST LIMIT 30`,
      [userId]
    );
    return res.rows.map((r) => {
      const bet = Number(r.bet_amount);
      let result = 'CANCELLED';
      let net = 0;
      if (r.status === 'FINISHED') {
        if (r.is_draw) { result = 'DRAW'; net = 0; } else if (r.is_winner) { result = 'WIN'; net = Number(r.my_prize) - bet; } else { result = 'LOSS'; net = -bet; }
      }
      return {
        code: r.room_code, result, reason: r.end_reason, bet, pot: Number(r.pot_total), commission: Number(r.commission_taken),
        payout: Number(r.my_prize), net, opponent: r.opp_name ? `@${maskUsername(r.opp_name)}` : null, endedAt: r.ended_at,
      };
    });
  }

  // ------------------------------------------------------------------ realtime
  send(ws, type, payload) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
  }

  async afterChange(code, events = []) {
    const loaded = await this.loadRoom(code);
    if (!loaded) return;
    const { room } = loaded;
    if (room.status === 'WAITING' || room.status === 'IN_PROGRESS') this.schedule(code, this.deadlineOf(room));
    else this.schedule(code, null);
    const set = this.roomSockets.get(code);
    if (set && set.size) {
      const payload = { state: this.buildState(room, loaded.players, await this.settings()), events };
      for (const ws of set) this.send(ws, 'dama_state', payload);
    }
  }

  leaveRoomSocket(ws, code) {
    const set = this.roomSockets.get(code);
    if (!set || !set.has(ws)) return;
    set.delete(ws);
    if (!set.size) this.roomSockets.delete(code);
    this.afterChange(code).catch(() => {});
  }

  /** Called by wsServer for every message. Returns true when the message belonged to Dama. */
  async handleSocketMessage(ws, user, msg) {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('dama_')) return false;
    ws.damaUserId = user.sub;
    ws.damaRooms = ws.damaRooms || new Set();
    try {
      const now = Date.now();
      if (now - (ws.damaLast || 0) < ACTION_GAP_MS && ['dama_move', 'dama_resign'].includes(msg.type)) throw new DamaError('RATE', 'ቀስ ብለው ይጫኑ');
      ws.damaLast = now;
      const p = msg.payload || {};
      const code = typeof p.code === 'string' ? p.code.toUpperCase().slice(0, 10) : null;
      if (!code) throw new DamaError('BAD_INPUT', 'Room code ያስፈልጋል');
      switch (msg.type) {
        case 'dama_enter': {
          await this.init();
          const loaded = await this.loadRoom(code);
          if (!loaded || !loaded.players.some((x) => String(x.user_id) === String(user.sub))) throw new DamaError('NOT_PLAYER', 'በዚህ ክፍል ውስጥ አይደሉም');
          if (!this.roomSockets.has(code)) this.roomSockets.set(code, new Set());
          this.roomSockets.get(code).add(ws);
          ws.damaRooms.add(code);
          await this.afterChange(code);
          break;
        }
        case 'dama_exit':
          ws.damaRooms.delete(code);
          this.leaveRoomSocket(ws, code);
          break;
        case 'dama_move':
          await this.moveAction(user.sub, code, Number(p.from), Number(p.to), p.moveNo === undefined ? undefined : Number(p.moveNo));
          break;
        case 'dama_resign':
          await this.resignAction(user.sub, code);
          break;
        default:
          throw new DamaError('BAD_INPUT', `Unknown event type: ${msg.type}`);
      }
    } catch (e) {
      if (!(e instanceof DamaError)) console.error('[dama] ws', msg.type, e.message);
      this.send(ws, 'dama_error', { code: e.code || 'ERROR', message: e instanceof DamaError ? e.userMessage : 'ስህተት ተፈጥሯል' });
      if (e && e.code === 'STALE' && msg.payload && msg.payload.code) this.afterChange(String(msg.payload.code).toUpperCase()).catch(() => {});
    }
    return true;
  }

  handleSocketClose(ws) {
    if (ws.damaRooms) for (const code of [...ws.damaRooms]) this.leaveRoomSocket(ws, code);
  }

  // ------------------------------------------------------------------ admin
  async adminOverview() {
    const [live, recent, events, totals, cfg] = await Promise.all([
      query(
        `SELECT r.room_code, r.status, r.bet_amount, r.pot_total, r.created_at, r.started_at, r.wait_deadline,
                (SELECT COUNT(*) FROM dama_players p WHERE p.room_id = r.id) AS players
         FROM dama_rooms r WHERE r.status IN ('WAITING','IN_PROGRESS') ORDER BY r.created_at DESC LIMIT 100`
      ),
      query(
        `SELECT r.room_code, r.status, r.bet_amount, r.pot_total, r.commission_taken, r.prize, r.is_draw, r.end_reason, r.ended_at,
                u.user_id_5d AS winner_id_5d, u.username AS winner_username
         FROM dama_rooms r LEFT JOIN users u ON u.id = r.winner_user_id
         WHERE r.status IN ('FINISHED','CANCELLED') ORDER BY r.ended_at DESC NULLS LAST LIMIT 100`
      ),
      query('SELECT id, room_id, user_id, kind, detail, created_at FROM dama_events ORDER BY created_at DESC LIMIT 100'),
      query(`SELECT COUNT(*) FILTER (WHERE status = 'FINISHED') AS finished, COALESCE(SUM(commission_taken) FILTER (WHERE status = 'FINISHED'), 0) AS commission, COALESCE(SUM(prize) FILTER (WHERE status = 'FINISHED'), 0) AS paid FROM dama_rooms`),
      this.settings(),
    ]);
    return {
      settings: cfg,
      totals: { finished: Number(totals.rows[0].finished), commission: Number(totals.rows[0].commission), paid: Number(totals.rows[0].paid) },
      live: live.rows,
      recent: recent.rows,
      events: events.rows,
    };
  }
}

const manager = new DamaManager();
module.exports = { manager, DamaError, DEFAULT_BETS, TURN_OPTIONS, COMMISSION_PERCENT, payoutFor };
