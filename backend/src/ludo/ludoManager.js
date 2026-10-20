'use strict';
/**
 * KING LUDO — room lifecycle, wallet movements, authoritative timers and realtime push.
 *
 * Source of truth = PostgreSQL (ludo_* tables). Every state change runs in a transaction that
 * locks the room row (SELECT … FOR UPDATE), so a double click, a late timer or two servers can
 * never apply the same action twice. In-memory data is only sockets and setTimeout handles,
 * and all of it is rebuilt from the database after a restart (init()).
 *
 * Money rules (existing wallets/transactions tables, no new money tables):
 *   - Free room (bet 0): no transaction at all.
 *   - Paid room: GAME_ENTRY when a player takes a seat, GAME_REFUND if the room expires/is left,
 *     PRIZE exactly once when the game ends. Prize = all stakes - 10% commission of every stake.
 */
const crypto = require('crypto');
const { query, withTransaction } = require('../config/db');
const E = require('./ludoEngine');
const SCHEMA = require('./ludoSchema');
const { maskUsername } = require('../utils/validators');
const { unlockBonusAfterFirstGame } = require('../models/walletModel');
const { notifyLudoPrize, notifyLudoRefund } = require('./ludoNotify');

const BETS = [0, 20, 30, 50, 100, 200, 300, 500, 700, 1000, 2000, 3000, 4000, 5000, 7000, 10000];
const CAPACITIES = [2, 4];
const CROWNS = [1, 2, 4];
const COMMISSION_PERCENT = 10;
const WAIT_MS = 3 * 60 * 1000; // 3 minutes, owned by the server
const SWEEP_MS = 15 * 1000; // safety net for lost timers
const ACTION_GAP_MS = 150; // per-socket flood guard

const money = (n) => Math.round(Number(n) * 100) / 100;

class LudoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.userMessage = message;
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode() {
  let s = '';
  for (let i = 0; i < 6; i += 1) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

function prizeFor(bet, count) {
  const gross = money(bet * count);
  const commission = money(gross * (COMMISSION_PERCENT / 100));
  return { gross, commission, prize: money(gross - commission) };
}

class LudoManager {
  constructor() {
    this.timers = new Map(); // code -> Timeout
    this.roomSockets = new Map(); // code -> Set<ws>
    this.lobbySockets = new Set();
    this.lobbyTimer = null;
    this.ready = null;
    this.sweeper = null;
  }

  // ------------------------------------------------------------------ startup
  init() {
    if (!this.ready) {
      this.ready = (async () => {
        await query(SCHEMA);
        const live = await query(`SELECT room_code, status, wait_deadline, state FROM ludo_rooms WHERE status IN ('WAITING','IN_PROGRESS')`);
        for (const r of live.rows) this.schedule(r.room_code, this.deadlineOf(r));
        this.sweeper = setInterval(() => this.sweep().catch((e) => console.error('[ludo] sweep', e.message)), SWEEP_MS);
        this.sweeper.unref();
        console.log(`[ludo] ready, ${live.rowCount} live room(s) restored`);
      })().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
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
      this.onTimer(code).catch((e) => console.error('[ludo] timer', code, e.message));
    }, Math.max(0, atMs - Date.now()) + 40);
    t.unref();
    this.timers.set(code, t);
  }

  async sweep() {
    const res = await query(
      `SELECT room_code FROM ludo_rooms
       WHERE (status = 'WAITING' AND wait_deadline <= now())
          OR (status = 'IN_PROGRESS' AND (state->>'deadline')::bigint <= $1)`,
      [Date.now() - 1000]
    );
    for (const r of res.rows) await this.onTimer(r.room_code);
  }

  async onTimer(code) {
    const res = await query('SELECT status FROM ludo_rooms WHERE room_code = $1', [code]);
    if (!res.rowCount) return;
    if (res.rows[0].status === 'WAITING') await this.expireRoom(code);
    else if (res.rows[0].status === 'IN_PROGRESS') await this.processTimeout(code);
  }

  // ------------------------------------------------------------------ wallet helpers (inside a tx)
  async charge(client, userId, amount, code) {
    const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (!w.rowCount) throw new LudoError('NO_WALLET', 'Wallet አልተገኘም');
    const before = Number(w.rows[0].balance);
    if (before < amount) throw new LudoError('INSUFFICIENT_BALANCE', 'ቀሪ ሂሳብዎ (ETB) ለመግባት በቂ አይደለም');
    const after = money(before - amount);
    await client.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE user_id = $1', [userId, after]);
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status, reference_note)
       VALUES ($1, 'GAME_ENTRY', $2, $3, $4, 'COMPLETED', $5)`,
      [userId, amount, before, after, `LUDO:${code}`]
    );
  }

  async credit(client, userId, amount, type, code) {
    const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    const before = Number(w.rows[0].balance);
    const after = money(before + amount);
    await client.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE user_id = $1', [userId, after]);
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status, reference_note)
       VALUES ($1, $2, $3, $4, $5, 'COMPLETED', $6)`,
      [userId, type, amount, before, after, `LUDO:${code}`]
    );
  }

  async logEvent(roomId, userId, kind, detail) {
    try {
      await query('INSERT INTO ludo_events (room_id, user_id, kind, detail) VALUES ($1, $2, $3, $4)', [roomId || null, userId || null, kind, detail ? JSON.stringify(detail) : null]);
    } catch (e) {
      console.error('[ludo] logEvent', e.message);
    }
  }

  validateSettings({ capacity, bet, crowns }) {
    capacity = Number(capacity);
    bet = Number(bet);
    crowns = Number(crowns);
    if (!CAPACITIES.includes(capacity)) throw new LudoError('BAD_INPUT', 'የተጫዋች ብዛት 2 ወይም 4 መሆን አለበት');
    if (!BETS.includes(bet)) throw new LudoError('BAD_INPUT', 'የውርርድ መጠን ልክ አይደለም');
    if (!CROWNS.includes(crowns)) throw new LudoError('BAD_INPUT', 'የ crown ምርጫ ልክ አይደለም');
    return { capacity, bet, crowns };
  }

  // ------------------------------------------------------------------ rooms: create / join / leave
  async addPlayer(client, room, userId) {
    const bet = Number(room.bet_amount);
    if (bet > 0) await this.charge(client, userId, bet, room.room_code);
    await client.query('INSERT INTO ludo_players (room_id, user_id, stake_paid) VALUES ($1, $2, $3)', [room.id, userId, bet]);
  }

  async createRoom(userId, settings) {
    const { capacity, bet, crowns } = this.validateSettings(settings);
    const code = await withTransaction(async (client) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const c = genCode();
        const ins = await client.query(
          `INSERT INTO ludo_rooms (room_code, creator_id, capacity, bet_amount, crowns, wait_deadline)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (room_code) DO NOTHING RETURNING *`,
          [c, userId, capacity, bet, crowns, new Date(Date.now() + WAIT_MS)]
        );
        if (ins.rowCount) {
          await this.addPlayer(client, ins.rows[0], userId);
          await this.refreshPot(client, ins.rows[0].id, bet);
          return c;
        }
      }
      throw new LudoError('BUSY', 'እባክዎ እንደገና ይሞክሩ');
    });
    await this.afterChange(code);
    return code;
  }

  async refreshPot(client, roomId, bet) {
    const cnt = await client.query('SELECT COUNT(*) AS c FROM ludo_players WHERE room_id = $1', [roomId]);
    const { gross, commission } = prizeFor(bet, Number(cnt.rows[0].c));
    await client.query('UPDATE ludo_rooms SET pot_total = $2, commission_taken = $3 WHERE id = $1', [roomId, gross, commission]);
  }

  async joinRoom(userId, code) {
    const started = await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM ludo_rooms WHERE room_code = $1 FOR UPDATE', [code]);
      if (!r.rowCount) throw new LudoError('NOT_FOUND', 'ክፍሉ አልተገኘም');
      const room = r.rows[0];
      if (room.status !== 'WAITING' || new Date(room.wait_deadline).getTime() <= Date.now()) {
        throw new LudoError('CLOSED', 'ይህ ክፍል ከአሁን በኋላ ተጫዋች አይቀበልም');
      }
      const players = await client.query('SELECT user_id FROM ludo_players WHERE room_id = $1 ORDER BY joined_at, id', [room.id]);
      if (players.rows.some((p) => String(p.user_id) === String(userId))) throw new LudoError('ALREADY_JOINED', 'አስቀድመው ገብተዋል');
      if (players.rowCount >= room.capacity) throw new LudoError('FULL', 'ክፍሉ ሞልቷል');

      await this.addPlayer(client, room, userId);
      const count = players.rowCount + 1;
      await this.refreshPot(client, room.id, Number(room.bet_amount));
      if (count === room.capacity) {
        await this.startGame(client, room);
        return true;
      }
      // 4-player rooms: every new player restarts the 3 minute wait for the remaining seats
      await client.query('UPDATE ludo_rooms SET wait_deadline = $2 WHERE id = $1', [room.id, new Date(Date.now() + WAIT_MS)]);
      return false;
    });
    await this.afterChange(code);
    return { code, started };
  }

  /** PLAY NOW: re-use my waiting room, join a matching one, otherwise create a new room. */
  async playNow(userId, settings) {
    const s = this.validateSettings(settings);
    const mine = await query(
      `SELECT r.room_code FROM ludo_rooms r JOIN ludo_players p ON p.room_id = r.id
       WHERE p.user_id = $1 AND r.status = 'WAITING' AND r.capacity = $2 AND r.bet_amount = $3 AND r.crowns = $4 LIMIT 1`,
      [userId, s.capacity, s.bet, s.crowns]
    );
    if (mine.rowCount) return { code: mine.rows[0].room_code, started: false };

    const open = await query(
      `SELECT r.room_code FROM ludo_rooms r
       WHERE r.status = 'WAITING' AND r.wait_deadline > now() AND r.capacity = $1 AND r.bet_amount = $2 AND r.crowns = $3
         AND (SELECT COUNT(*) FROM ludo_players p WHERE p.room_id = r.id) < r.capacity
         AND NOT EXISTS (SELECT 1 FROM ludo_players p WHERE p.room_id = r.id AND p.user_id = $4)
       ORDER BY r.created_at ASC LIMIT 5`,
      [s.capacity, s.bet, s.crowns, userId]
    );
    for (const row of open.rows) {
      try {
        return await this.joinRoom(userId, row.room_code);
      } catch (e) {
        if (!(e instanceof LudoError) || !['FULL', 'CLOSED', 'ALREADY_JOINED'].includes(e.code)) throw e; // someone was faster: try the next one
      }
    }
    const code = await this.createRoom(userId, s);
    return { code, started: false };
  }

  async leaveRoom(userId, code) {
    const after = [];
    await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM ludo_rooms WHERE room_code = $1 FOR UPDATE', [code]);
      if (!r.rowCount) throw new LudoError('NOT_FOUND', 'ክፍሉ አልተገኘም');
      const room = r.rows[0];
      if (room.status !== 'WAITING') throw new LudoError('STARTED', 'ጨዋታው ተጀምሯል፤ መውጣት አይቻልም');
      const p = await client.query('DELETE FROM ludo_players WHERE room_id = $1 AND user_id = $2 RETURNING stake_paid', [room.id, userId]);
      if (!p.rowCount) throw new LudoError('NOT_PLAYER', 'በዚህ ክፍል ውስጥ የሉም');
      const stake = Number(p.rows[0].stake_paid);
      if (stake > 0) {
        await this.credit(client, userId, stake, 'GAME_REFUND', code);
        after.push(() => notifyLudoRefund(userId, stake));
      }
      const left = await client.query('SELECT user_id FROM ludo_players WHERE room_id = $1 ORDER BY joined_at, id', [room.id]);
      if (!left.rowCount) {
        await client.query(`UPDATE ludo_rooms SET status = 'CANCELLED', end_reason = 'EMPTY', ended_at = now(), pot_total = 0, commission_taken = 0 WHERE id = $1`, [room.id]);
      } else {
        await client.query('UPDATE ludo_rooms SET creator_id = $2 WHERE id = $1', [room.id, left.rows[0].user_id]);
        await this.refreshPot(client, room.id, Number(room.bet_amount));
      }
    });
    after.forEach((fn) => fn());
    await this.afterChange(code);
  }

  /** The 3 minutes ran out with an incomplete room: everybody is refunded and the room closes. */
  async expireRoom(code) {
    const after = [];
    const done = await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM ludo_rooms WHERE room_code = $1 FOR UPDATE', [code]);
      if (!r.rowCount) return false;
      const room = r.rows[0];
      if (room.status !== 'WAITING' || new Date(room.wait_deadline).getTime() > Date.now()) return false;
      const players = await client.query('SELECT user_id, stake_paid FROM ludo_players WHERE room_id = $1', [room.id]);
      for (const p of players.rows) {
        const stake = Number(p.stake_paid);
        if (stake > 0) {
          await this.credit(client, p.user_id, stake, 'GAME_REFUND', code);
          after.push(() => notifyLudoRefund(p.user_id, stake));
        }
      }
      await client.query(`UPDATE ludo_players SET status = 'LEFT' WHERE room_id = $1`, [room.id]);
      await client.query(`UPDATE ludo_rooms SET status = 'CANCELLED', end_reason = 'EXPIRED', ended_at = now() WHERE id = $1`, [room.id]);
      return true;
    });
    after.forEach((fn) => fn());
    if (done) await this.afterChange(code);
  }

  // ------------------------------------------------------------------ game start / actions
  async startGame(client, room) {
    const players = await client.query('SELECT user_id FROM ludo_players WHERE room_id = $1 ORDER BY joined_at, id', [room.id]);
    const state = E.createGame({ players: players.rows.map((p) => ({ userId: String(p.user_id) })), capacity: room.capacity, crowns: room.crowns }, Date.now());
    for (let i = 0; i < players.rows.length; i += 1) {
      await client.query('UPDATE ludo_players SET seat = $3 WHERE room_id = $1 AND user_id = $2', [room.id, players.rows[i].user_id, state.seats[i]]);
      if (Number(room.bet_amount) > 0) await unlockBonusAfterFirstGame(client, players.rows[i].user_id);
    }
    await client.query(`UPDATE ludo_rooms SET status = 'IN_PROGRESS', state = $2, started_at = now(), wait_deadline = NULL WHERE id = $1`, [room.id, JSON.stringify(state)]);
  }

  async persist(client, room, state, events) {
    await client.query('UPDATE ludo_rooms SET state = $2 WHERE id = $1', [room.id, JSON.stringify(state)]);
    for (const ev of events) {
      const uid = state.players[ev.seat] ? Number(state.players[ev.seat].userId) : null;
      if (ev.type === 'rolled') {
        await client.query(`INSERT INTO ludo_turns (room_id, turn_no, user_id, seat, kind, dice, auto) VALUES ($1,$2,$3,$4,'ROLL',$5,$6)`, [room.id, state.turnNo, uid, ev.seat, ev.dice, ev.auto]);
      } else if (ev.type === 'moved') {
        await client.query(
          `INSERT INTO ludo_turns (room_id, turn_no, user_id, seat, kind, dice, auto, token_idx, from_pos, to_pos, captured) VALUES ($1,$2,$3,$4,'MOVE',$5,$6,$7,$8,$9,$10)`,
          [room.id, state.turnNo, uid, ev.seat, ev.dice, ev.auto, ev.token, ev.from, ev.to, JSON.stringify(ev.captured || [])]
        );
      } else if (ev.type === 'passed') {
        await client.query(`INSERT INTO ludo_turns (room_id, turn_no, user_id, seat, kind) VALUES ($1,$2,$3,$4,'PASS')`, [room.id, state.turnNo, uid, ev.seat]);
      } else if (ev.type === 'removed') {
        await client.query(`INSERT INTO ludo_turns (room_id, turn_no, user_id, seat, kind) VALUES ($1,$2,$3,$4,'REMOVED')`, [room.id, state.turnNo, uid, ev.seat]);
        await client.query(`UPDATE ludo_players SET status = 'REMOVED' WHERE room_id = $1 AND user_id = $2`, [room.id, uid]);
      }
    }
  }

  /** Called inside the action transaction when the engine reports the game is over. Pays exactly once. */
  async finishGame(client, room, state, after) {
    const winnerSeat = state.winnerSeat;
    const winnerUserId = Number(state.players[winnerSeat].userId);
    const players = await client.query('SELECT user_id, stake_paid FROM ludo_players WHERE room_id = $1', [room.id]);
    let prize = 0;
    let commission = 0;
    const bet = Number(room.bet_amount);
    if (bet > 0) {
      const gross = money(players.rows.reduce((s, p) => s + Number(p.stake_paid), 0));
      commission = money(players.rows.reduce((s, p) => s + Number(p.stake_paid) * (COMMISSION_PERCENT / 100), 0));
      prize = money(gross - commission);
      await this.credit(client, winnerUserId, prize, 'PRIZE', room.room_code);
      after.push(() => notifyLudoPrize(winnerUserId, prize));
    }
    await client.query('UPDATE ludo_players SET is_winner = TRUE, prize = $3 WHERE room_id = $1 AND user_id = $2', [room.id, winnerUserId, prize]);
    await client.query(
      `UPDATE ludo_rooms SET status = 'FINISHED', winner_user_id = $2, prize = $3, commission_taken = $4, end_reason = $5, ended_at = now() WHERE id = $1`,
      [room.id, winnerUserId, prize, commission, state.endReason]
    );
  }

  /** Runs one engine step under the room lock. `step(state, now)` returns the events (or null). */
  async runLocked(code, step) {
    const after = [];
    const out = await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM ludo_rooms WHERE room_code = $1 FOR UPDATE', [code]);
      if (!r.rowCount) throw new LudoError('NOT_FOUND', 'ክፍሉ አልተገኘም');
      const room = r.rows[0];
      if (room.status !== 'IN_PROGRESS' || !room.state) return { events: null, room };
      const state = room.state;
      const events = step(state, Date.now(), room);
      if (!events) return { events: null, room };
      await this.persist(client, room, state, events);
      if (state.phase === 'DONE') await this.finishGame(client, room, state, after);
      return { events, room, state };
    });
    after.forEach((fn) => fn());
    return out;
  }

  seatOf(state, userId) {
    const idx = state.players.findIndex((p) => p && String(p.userId) === String(userId));
    return idx === -1 ? null : idx;
  }

  async playerAction(userId, code, kind, token) {
    let rejected = null;
    let result;
    try {
      result = await this.runLocked(code, (state, now, room) => {
        const seat = this.seatOf(state, userId);
        if (seat === null) throw new LudoError('NOT_PLAYER', 'በዚህ ጨዋታ ውስጥ አይደሉም');
        if (state.players[seat].removed) throw new LudoError('REMOVED', 'ከጨዋታው ተወግደዋል');
        if (state.deadline && now >= state.deadline) throw new LudoError('STALE', 'ጊዜው አልፏል፤ እየተዘመነ ነው');
        try {
          if (kind === 'roll') return E.roll(state, seat, now, { auto: false });
          if (!Number.isInteger(token)) throw new Error('Illegal move');
          return E.applyMove(state, seat, token, now, { auto: false });
        } catch (e) {
          if (e instanceof LudoError) throw e;
          rejected = { room, seat, message: e.message };
          throw new LudoError('ILLEGAL', 'ይህ እርምጃ አይፈቀድም');
        }
      });
    } catch (e) {
      if (rejected) await this.logEvent(rejected.room.id, userId, 'ILLEGAL_ACTION', { kind, token, reason: rejected.message });
      throw e;
    }
    if (!result.events) throw new LudoError('NOT_ACTIVE', 'ጨዋታው አልተጀመረም ወይም አብቅቷል');
    await this.afterChange(code, result.events);
  }

  async processTimeout(code) {
    const result = await this.runLocked(code, (state, now) => E.handleTimeout(state, now));
    if (result.events) await this.afterChange(code, result.events);
    else if (result.room && result.room.status === 'IN_PROGRESS') this.schedule(code, this.deadlineOf(result.room)); // woke early
  }

  // ------------------------------------------------------------------ views
  async loadRoom(code) {
    const r = await query('SELECT * FROM ludo_rooms WHERE room_code = $1', [code]);
    if (!r.rowCount) return null;
    const room = r.rows[0];
    const p = await query(
      `SELECT p.user_id, p.seat, p.status, p.is_winner, p.prize, u.user_id_5d, u.username
       FROM ludo_players p JOIN users u ON u.id = p.user_id WHERE p.room_id = $1 ORDER BY p.joined_at, p.id`,
      [room.id]
    );
    return { room, players: p.rows };
  }

  connectedUserIds(code) {
    const set = this.roomSockets.get(code);
    return new Set(set ? [...set].map((ws) => String(ws.ludoUserId)) : []);
  }

  buildState(room, players) {
    const bet = Number(room.bet_amount);
    const connected = this.connectedUserIds(room.room_code);
    const st = room.state;
    const view = {
      code: room.room_code,
      capacity: room.capacity,
      crowns: room.crowns,
      bet,
      commissionPercent: COMMISSION_PERCENT,
      prize: bet > 0 ? prizeFor(bet, room.capacity).prize : 0,
      status: room.status,
      endReason: room.end_reason,
      waitDeadline: room.status === 'WAITING' && room.wait_deadline ? new Date(room.wait_deadline).getTime() : null,
      serverNow: Date.now(),
      paid: room.status === 'FINISHED' ? Number(room.prize) : null,
      players: players.map((p) => {
        const seat = st ? this.seatOf(st, p.user_id) : null;
        return {
          userId5d: p.user_id_5d,
          name: `@${maskUsername(p.username)}`,
          seat,
          color: seat === null ? null : E.COLORS[seat],
          removed: seat !== null ? !!st.players[seat].removed : p.status === 'REMOVED',
          missed: seat !== null ? st.players[seat].missed : 0,
          connected: connected.has(String(p.user_id)),
          winner: !!p.is_winner,
        };
      }),
      game: null,
    };
    if (st) {
      view.game = {
        seats: st.seats,
        turn: st.turn,
        phase: st.phase,
        dice: st.dice,
        legal: st.legal.map((m) => m.token),
        deadline: st.deadline,
        tokens: st.tokens,
        turnNo: st.turnNo,
        winnerSeat: st.winnerSeat,
      };
    }
    return view;
  }

  async publicState(code) {
    const loaded = await this.loadRoom(code);
    return loaded ? this.buildState(loaded.room, loaded.players) : null;
  }

  async lobbyRooms() {
    const res = await query(
      `SELECT r.room_code, r.capacity, r.bet_amount, r.crowns, r.wait_deadline,
              COALESCE(json_agg(json_build_object('name', u.username, 'userId5d', u.user_id_5d) ORDER BY p.joined_at, p.id) FILTER (WHERE u.id IS NOT NULL), '[]') AS players
       FROM ludo_rooms r
       LEFT JOIN ludo_players p ON p.room_id = r.id
       LEFT JOIN users u ON u.id = p.user_id
       WHERE r.status = 'WAITING' AND r.wait_deadline > now()
       GROUP BY r.id ORDER BY r.wait_deadline ASC LIMIT 200`
    );
    const now = Date.now();
    return {
      serverNow: now,
      rooms: res.rows.map((r) => {
        const bet = Number(r.bet_amount);
        return {
          code: r.room_code,
          capacity: r.capacity,
          crowns: r.crowns,
          bet,
          prize: bet > 0 ? prizeFor(bet, r.capacity).prize : 0,
          waitDeadline: new Date(r.wait_deadline).getTime(),
          players: r.players.map((p) => ({ name: `@${maskUsername(p.name)}`, userId5d: p.userId5d })),
          status: 'WAITING',
        };
      }),
    };
  }

  async myRooms(userId) {
    const res = await query(
      `SELECT r.room_code, r.status, r.capacity, r.bet_amount FROM ludo_rooms r JOIN ludo_players p ON p.room_id = r.id
       WHERE p.user_id = $1 AND r.status IN ('WAITING','IN_PROGRESS') AND p.status = 'ACTIVE' ORDER BY r.created_at DESC LIMIT 10`,
      [userId]
    );
    return res.rows.map((r) => ({ code: r.room_code, status: r.status, capacity: r.capacity, bet: Number(r.bet_amount) }));
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
    if (set) {
      const payload = { state: this.buildState(room, loaded.players), events };
      for (const ws of set) this.send(ws, 'ludo_state', payload);
    }
    this.pushLobby();
  }

  pushLobby() {
    if (this.lobbyTimer || !this.lobbySockets.size) return;
    this.lobbyTimer = setTimeout(async () => {
      this.lobbyTimer = null;
      try {
        const data = await this.lobbyRooms();
        for (const ws of this.lobbySockets) this.send(ws, 'ludo_lobby', data);
      } catch (e) {
        console.error('[ludo] lobby push', e.message);
      }
    }, 250);
    this.lobbyTimer.unref();
  }

  leaveRoomSocket(ws, code) {
    const set = this.roomSockets.get(code);
    if (!set || !set.has(ws)) return;
    set.delete(ws);
    if (!set.size) this.roomSockets.delete(code);
    this.afterChange(code).catch(() => {}); // connection flags changed
  }

  /** Called by wsServer for every message. Returns true when the message belonged to Ludo. */
  async handleSocketMessage(ws, user, msg) {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('ludo_')) return false;
    ws.ludoUserId = user.sub;
    ws.ludoRooms = ws.ludoRooms || new Set();
    try {
      const now = Date.now();
      if (now - (ws.ludoLast || 0) < ACTION_GAP_MS && (msg.type === 'ludo_roll' || msg.type === 'ludo_move')) {
        throw new LudoError('RATE', 'ቀስ ብለው ይጫኑ');
      }
      ws.ludoLast = now;
      const p = msg.payload || {};
      const code = typeof p.code === 'string' ? p.code.toUpperCase().slice(0, 10) : null;
      switch (msg.type) {
        case 'ludo_lobby':
          await this.init();
          this.lobbySockets.add(ws);
          this.send(ws, 'ludo_lobby', await this.lobbyRooms());
          break;
        case 'ludo_lobby_leave':
          this.lobbySockets.delete(ws);
          break;
        case 'ludo_enter': {
          if (!code) throw new LudoError('BAD_INPUT', 'Room code ያስፈልጋል');
          const loaded = await this.loadRoom(code);
          if (!loaded || !loaded.players.some((x) => String(x.user_id) === String(user.sub))) throw new LudoError('NOT_PLAYER', 'በዚህ ክፍል ውስጥ አይደሉም');
          if (!this.roomSockets.has(code)) this.roomSockets.set(code, new Set());
          this.roomSockets.get(code).add(ws);
          ws.ludoRooms.add(code);
          await this.afterChange(code); // everybody (incl. me) gets the fresh state + connection flags
          break;
        }
        case 'ludo_exit':
          if (code) {
            ws.ludoRooms.delete(code);
            this.leaveRoomSocket(ws, code);
          }
          break;
        case 'ludo_roll':
          if (!code) throw new LudoError('BAD_INPUT', 'Room code ያስፈልጋል');
          await this.playerAction(user.sub, code, 'roll');
          break;
        case 'ludo_move':
          if (!code) throw new LudoError('BAD_INPUT', 'Room code ያስፈልጋል');
          await this.playerAction(user.sub, code, 'move', Number(p.token));
          break;
        default:
          throw new LudoError('BAD_INPUT', `Unknown event type: ${msg.type}`);
      }
    } catch (e) {
      if (!(e instanceof LudoError)) console.error('[ludo] ws', msg.type, e.message);
      this.send(ws, 'ludo_error', { code: e.code || 'ERROR', message: e instanceof LudoError ? e.userMessage : 'ስህተት ተፈጥሯል' });
      if (e && e.code === 'STALE' && msg.payload && msg.payload.code) this.afterChange(String(msg.payload.code).toUpperCase()).catch(() => {});
    }
    return true;
  }

  handleSocketClose(ws) {
    this.lobbySockets.delete(ws);
    if (ws.ludoRooms) for (const code of [...ws.ludoRooms]) this.leaveRoomSocket(ws, code);
  }

  // ------------------------------------------------------------------ admin
  async adminOverview() {
    const [live, recent, events, totals] = await Promise.all([
      query(
        `SELECT r.room_code, r.status, r.capacity, r.crowns, r.bet_amount, r.pot_total, r.created_at, r.started_at, r.wait_deadline,
                (SELECT COUNT(*) FROM ludo_players p WHERE p.room_id = r.id) AS players
         FROM ludo_rooms r WHERE r.status IN ('WAITING','IN_PROGRESS') ORDER BY r.created_at DESC LIMIT 100`
      ),
      query(
        `SELECT r.room_code, r.status, r.capacity, r.crowns, r.bet_amount, r.pot_total, r.commission_taken, r.prize, r.end_reason, r.ended_at,
                u.user_id_5d AS winner_id_5d, u.username AS winner_username
         FROM ludo_rooms r LEFT JOIN users u ON u.id = r.winner_user_id
         WHERE r.status IN ('FINISHED','CANCELLED') ORDER BY r.ended_at DESC NULLS LAST LIMIT 100`
      ),
      query('SELECT id, room_id, user_id, kind, detail, created_at FROM ludo_events ORDER BY created_at DESC LIMIT 100'),
      query(`SELECT COUNT(*) FILTER (WHERE status = 'FINISHED') AS finished, COALESCE(SUM(commission_taken) FILTER (WHERE status = 'FINISHED'), 0) AS commission, COALESCE(SUM(prize) FILTER (WHERE status = 'FINISHED'), 0) AS paid FROM ludo_rooms`),
    ]);
    return {
      totals: { finished: Number(totals.rows[0].finished), commission: Number(totals.rows[0].commission), paid: Number(totals.rows[0].paid) },
      live: live.rows,
      recent: recent.rows,
      events: events.rows,
    };
  }
}

const manager = new LudoManager();
module.exports = { manager, LudoError, BETS, CAPACITIES, CROWNS, COMMISSION_PERCENT, WAIT_MS, prizeFor };
