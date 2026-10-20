const { withTransaction, query } = require('../config/db');
const { getCardById, checkWin, drawNextNumber, computePot } = require('./bingoEngine');
const { buildCall } = require('./amharicCaller');
const { maskUsername } = require('../utils/validators');
const { unlockBonusAfterFirstGame } = require('../models/walletModel');
const { notifyPrize, notifyRefund } = require('../utils/balanceNotify');

const CALL_INTERVAL_MS = 4500; // pacing between number calls

// Phase 1: how long the very first player waits alone for an opponent
// before being auto-refunded and sent back to the Lobby.
const FIRST_PLAYER_WAIT_SECONDS = 60;

// Phase 2: once the minimum number of players is reached, how long the
// room stays open for additional players before the game auto-starts.
const COUNTDOWN_SECONDS = 60;

/**
 * In-memory registry of live rooms. Each entry mirrors the DB row plus
 * runtime-only fields (timers, connected sockets). The DB remains the
 * source of truth for anything that must survive a restart or be audited.
 */
const liveRooms = new Map(); // room_code -> live room object

function randomRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

class RoomManager {
  constructor(broadcastFn) {
    // broadcastFn(roomCode, eventType, payload) pushes to all sockets in a room
    this.broadcast = broadcastFn;
  }

  async getOrCreateWaitingRoom(stakeTierId) {
    const existing = await query(
      `SELECT * FROM game_rooms WHERE stake_tier_id = $1 AND status IN ('WAITING', 'COUNTDOWN') ORDER BY created_at ASC LIMIT 1`,
      [stakeTierId]
    );
    if (existing.rowCount > 0) return existing.rows[0];

    const roomCode = randomRoomCode();
    const created = await query(
      `INSERT INTO game_rooms (room_code, stake_tier_id, status) VALUES ($1, $2, 'WAITING') RETURNING *`,
      [roomCode, stakeTierId]
    );
    return created.rows[0];
  }

  /**
   * Real player joins a real room, staking virtual credits (GAME_ENTRY tx).
   * Balance deduction and card assignment are atomic.
   */
  async joinRoom(roomId, userId, cardId) {
    return withTransaction(async (client) => {
      const roomRes = await client.query('SELECT * FROM game_rooms WHERE id = $1 FOR UPDATE', [roomId]);
      if (roomRes.rowCount === 0) throw new Error('Room not found');
      const room = roomRes.rows[0];
      if (room.status !== 'WAITING' && room.status !== 'COUNTDOWN') {
        throw new Error('Room is no longer accepting players');
      }

      const tierRes = await client.query('SELECT * FROM stake_tiers WHERE id = $1', [room.stake_tier_id]);
      const tier = tierRes.rows[0];

      const already = await client.query(
        'SELECT 1 FROM game_entries WHERE game_room_id = $1 AND user_id = $2',
        [roomId, userId]
      );
      if (already.rowCount > 0) throw new Error('Already joined this room');

      // the chosen card number must still be free in this room
      const cardLayout = getCardById(cardId);
      if (!cardLayout) {
        const err = new Error('Invalid card number');
        err.code = 'INVALID_CARD';
        throw err;
      }
      const cardTaken = await client.query(
        'SELECT 1 FROM game_entries WHERE game_room_id = $1 AND card_id = $2',
        [roomId, cardId]
      );
      if (cardTaken.rowCount > 0) {
        const err = new Error('This card was just taken by another player. Please pick a different card.');
        err.code = 'CARD_TAKEN';
        throw err;
      }

      const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
      const wallet = walletRes.rows[0];
      const withdrawableEtc = Number(wallet.balance); // full balance (locked bonus is still usable for game entry)
      if (withdrawableEtc < Number(tier.entry_credits)) {
        const err = new Error('ቀሪ ሂሳብዎ (ETB) ለመግባት በቂ አይደለም');
        err.code = 'INSUFFICIENT_BALANCE';
        throw err;
      }

      const newBalance = Number(wallet.balance) - Number(tier.entry_credits);
      await client.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE user_id = $1', [
        userId,
        newBalance,
      ]);

      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status, game_room_id)
         VALUES ($1, 'GAME_ENTRY', $2, $3, $4, 'COMPLETED', $5)`,
        [userId, tier.entry_credits, wallet.balance, newBalance, roomId]
      );

      const card = cardLayout;
      const entry = await client.query(
        `INSERT INTO game_entries (game_room_id, user_id, card_id, card_numbers) VALUES ($1, $2, $3, $4) RETURNING *`,
        [roomId, userId, cardId, JSON.stringify(card)]
      );

      // pot recompute
      const countRes = await client.query('SELECT COUNT(*) FROM game_entries WHERE game_room_id = $1', [roomId]);
      const playerCount = Number(countRes.rows[0].count);
      const { netPot, commission } = computePot(Number(tier.entry_credits), playerCount, Number(tier.commission_percent));
      await client.query('UPDATE game_rooms SET pot_total = $2, commission_taken = $3 WHERE id = $1', [
        roomId,
        netPot,
        commission,
      ]);

      let updatedStatus = room.status;
      if (room.status === 'WAITING' && playerCount >= tier.min_players) {
        updatedStatus = 'COUNTDOWN';
        await client.query('UPDATE game_rooms SET status = $2 WHERE id = $1', [roomId, 'COUNTDOWN']);
      }

      return { room: { ...room, status: updatedStatus, pot_total: netPot }, entry: entry.rows[0], card, cardId, playerCount };
    });
  }

  // ------------------------------------------------------------------
  // PHASE 1: lone first player waits up to FIRST_PLAYER_WAIT_SECONDS for
  // an opponent. If nobody joins in time, the room is cancelled and the
  // player is automatically refunded their entry fee.
  // ------------------------------------------------------------------
  scheduleWaitingTimeout(roomCode, roomId) {
    const live = liveRooms.get(roomCode) || {};
    if (live.waitingInterval) return; // already running, don't double-schedule

    let secondsLeft = FIRST_PLAYER_WAIT_SECONDS;
    this.broadcast(roomCode, 'waiting_started', { secondsLeft });

    const interval = setInterval(async () => {
      secondsLeft -= 1;
      this.broadcast(roomCode, 'waiting_tick', { secondsLeft });
      if (secondsLeft <= 0) {
        clearInterval(interval);
        const stillWaiting = liveRooms.get(roomCode);
        if (stillWaiting) stillWaiting.waitingInterval = null;
        await this.cancelRoomAndRefund(roomCode, roomId);
      }
    }, 1000);

    live.waitingInterval = interval;
    liveRooms.set(roomCode, live);
  }

  /** Stops the phase-1 waiting timer (called once a second player joins). */
  clearWaitingTimer(roomCode) {
    const live = liveRooms.get(roomCode);
    if (live && live.waitingInterval) {
      clearInterval(live.waitingInterval);
      live.waitingInterval = null;
    }
  }

  /**
   * Cancels a room that never reached its minimum player count in time,
   * refunding every seated player's entry fee as a real, audited
   * GAME_REFUND transaction.
   */
  async cancelRoomAndRefund(roomCode, roomId) {
    // Someone may have joined (room moved to COUNTDOWN) just before this ran,
    // so only cancel if the room is still WAITING.
    const result = await this.refundAndCancel(roomId, ['WAITING']);

    if (result) {
      this.broadcast(roomCode, 'waiting_timeout', { roomId });
    }
    liveRooms.delete(roomCode);
  }

  /**
   * Refunds every seated player's entry fee (audited GAME_REFUND rows) and
   * marks the room CANCELLED. Only acts if the room is in one of the
   * allowed statuses, so it can never refund twice.
   */
  async refundAndCancel(roomId, allowedStatuses) {
    const refunded = [];
    const cancelledRoom = await withTransaction(async (client) => {
      const roomRes = await client.query('SELECT * FROM game_rooms WHERE id = $1 FOR UPDATE', [roomId]);
      const room = roomRes.rows[0];
      if (!room || !allowedStatuses.includes(room.status)) return null;

      const tierRes = await client.query('SELECT entry_credits FROM stake_tiers WHERE id = $1', [room.stake_tier_id]);
      const entryFee = Number(tierRes.rows[0].entry_credits);

      const entriesRes = await client.query('SELECT * FROM game_entries WHERE game_room_id = $1', [roomId]);
      for (const entry of entriesRes.rows) {
        const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [entry.user_id]);
        const wallet = walletRes.rows[0];
        const newBalance = Number(wallet.balance) + entryFee;

        await client.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE user_id = $1', [
          entry.user_id,
          newBalance,
        ]);

        await client.query(
          `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status, game_room_id)
           VALUES ($1, 'GAME_REFUND', $2, $3, $4, 'COMPLETED', $5)`,
          [entry.user_id, entryFee, wallet.balance, newBalance, roomId]
        );
        refunded.push({ userId: entry.user_id, amount: entryFee });
      }

      await client.query(`UPDATE game_rooms SET status = 'CANCELLED', ended_at = now() WHERE id = $1`, [roomId]);
      return room;
    });
    if (cancelledRoom) refunded.forEach((r) => notifyRefund(r.userId, r.amount)); // after the refund is committed
    return cancelledRoom;
  }

  /**
   * Called once when the server starts. Timers live in memory, so after a
   * restart any room still WAITING / COUNTDOWN / IN_PROGRESS is stuck forever
   * with players' credits already deducted. Cancel those rooms and refund.
   */
  async recoverStuckRooms() {
    const res = await query(
      `SELECT id, room_code FROM game_rooms WHERE status IN ('WAITING', 'COUNTDOWN', 'IN_PROGRESS')`
    );
    for (const r of res.rows) {
      try {
        const done = await this.refundAndCancel(r.id, ['WAITING', 'COUNTDOWN', 'IN_PROGRESS']);
        if (done) console.log(`[recover] room ${r.room_code} cancelled and refunded after restart`);
      } catch (err) {
        console.error(`[recover] room ${r.room_code} failed:`, err.message);
      }
    }
  }

  // ------------------------------------------------------------------
  // PHASE 2: once the minimum player count is reached, keep the room open
  // for COUNTDOWN_SECONDS so more players can still join, then start.
  // ------------------------------------------------------------------
  scheduleGameStart(roomCode, roomId) {
    if (liveRooms.has(roomCode) && liveRooms.get(roomCode).countdownTimer) return; // already scheduled

    let secondsLeft = COUNTDOWN_SECONDS;
    this.broadcast(roomCode, 'countdown_started', { secondsLeft });

    const tick = setInterval(async () => {
      secondsLeft -= 1;
      this.broadcast(roomCode, 'countdown_tick', { secondsLeft });
      if (secondsLeft <= 0) {
        clearInterval(tick);
        await this.startGame(roomCode, roomId);
      }
    }, 1000);

    const live = liveRooms.get(roomCode) || {};
    live.countdownTimer = tick;
    liveRooms.set(roomCode, live);
  }

  async startGame(roomCode, roomId) {
    await query(`UPDATE game_rooms SET status = 'IN_PROGRESS', started_at = now() WHERE id = $1`, [roomId]);
    this.broadcast(roomCode, 'game_started', { roomId });

    const live = liveRooms.get(roomCode) || {};
    live.calledNumbers = [];
    liveRooms.set(roomCode, live);

    this.callLoop(roomCode, roomId);
  }

  callLoop(roomCode, roomId) {
    const live = liveRooms.get(roomCode);

    const interval = setInterval(async () => {
      const roomRes = await query('SELECT * FROM game_rooms WHERE id = $1', [roomId]);
      const room = roomRes.rows[0];
      if (!room || room.status !== 'IN_PROGRESS') {
        clearInterval(interval);
        return;
      }

      const already = room.called_numbers || [];
      const nextNumber = drawNextNumber(already);

      if (nextNumber === null) {
        clearInterval(interval);
        await this.endGame(roomCode, roomId, null);
        return;
      }

      const updatedCalled = [...already, nextNumber];
      await query('UPDATE game_rooms SET called_numbers = $2 WHERE id = $1', [roomId, updatedCalled]);

      const call = buildCall(nextNumber);
      this.broadcast(roomCode, 'number_called', { ...call, calledNumbers: updatedCalled });
    }, CALL_INTERVAL_MS);

    live.callInterval = interval;
    liveRooms.set(roomCode, live);
  }

  /**
   * A player claims Bingo. Server-side validated against their stored card
   * and the room's actual called_numbers — the frontend claim is never
   * trusted on its own.
   */
  async claimBingo(roomId, roomCode, userId, markedNumbers) {
    return withTransaction(async (client) => {
      const roomRes = await client.query('SELECT * FROM game_rooms WHERE id = $1 FOR UPDATE', [roomId]);
      const room = roomRes.rows[0];
      if (!room || room.status !== 'IN_PROGRESS') {
        return { valid: false, reason: 'Game is not in progress' };
      }

      const entryRes = await client.query(
        'SELECT * FROM game_entries WHERE game_room_id = $1 AND user_id = $2 FOR UPDATE',
        [roomId, userId]
      );
      if (entryRes.rowCount === 0) return { valid: false, reason: 'Not a player in this room' };
      const entry = entryRes.rows[0];

      // only allow numbers that were actually called
      const calledSet = new Set(room.called_numbers);
      const claimedValid = markedNumbers.every((n) => n === 0 || calledSet.has(n));
      if (!claimedValid) return { valid: false, reason: 'Claim includes numbers never called' };

      const card = entry.card_numbers;
      const result = checkWin(card, markedNumbers);
      if (!result.won) return { valid: false, reason: 'No winning pattern found' };

      // winner confirmed — pay virtual prize, close the room
      await client.query('UPDATE game_entries SET is_winner = TRUE, marked_numbers = $2, prize_credits = $3 WHERE id = $1', [
        entry.id,
        markedNumbers,
        room.pot_total,
      ]);

      const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
      const wallet = walletRes.rows[0];
      const newBalance = Number(wallet.balance) + Number(room.pot_total);
      await client.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE user_id = $1', [
        userId,
        newBalance,
      ]);

      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status, game_room_id)
         VALUES ($1, 'PRIZE', $2, $3, $4, 'COMPLETED', $5)`,
        [userId, room.pot_total, wallet.balance, newBalance, roomId]
      );

      await client.query(
        `UPDATE game_rooms SET status = 'FINISHED', ended_at = now(), winner_pattern = $2 WHERE id = $1`,
        [roomId, result.pattern]
      );

      // unlock any locked first-join bonus now that they've played a real game
      await unlockBonusAfterFirstGame(client, userId);

      // public winner details for the celebration screens (username is masked: half hidden)
      const userRes = await client.query('SELECT user_id_5d, username FROM users WHERE id = $1', [userId]);
      const uname = String((userRes.rows[0] && userRes.rows[0].username) || '');
      const winner = {
        pattern: result.pattern,
        prize: room.pot_total,
        userId5d: userRes.rows[0] && userRes.rows[0].user_id_5d,
        usernameMasked: '@' + maskUsername(uname),
        cardId: entry.card_id,
        card: entry.card_numbers,
        calledNumbers: room.called_numbers || [],
      };

      return { valid: true, pattern: result.pattern, prize: room.pot_total, userId, winner };
    }).then(async (result) => {
      if (result.valid) {
        const live = liveRooms.get(roomCode);
        if (live && live.callInterval) clearInterval(live.callInterval);
        // everyone in the room gets the winner's details (never the internal user id)
        this.broadcast(roomCode, 'winner_declared', result.winner);
        this.broadcast(roomCode, 'game_ended', { roomId, ...result.winner });
        liveRooms.delete(roomCode);
        notifyPrize(result.userId, result.prize); // Telegram message to the winner
      }
      return result;
    });
  }

  async endGame(roomCode, roomId, winnerUserId) {
    // all 75 numbers called and nobody won -> cancel and refund everyone
    if (!winnerUserId) {
      const cancelled = await this.refundAndCancel(roomId, ['IN_PROGRESS']);
      this.broadcast(roomCode, 'game_ended', { roomId, winnerUserId: null, refunded: Boolean(cancelled) });
      liveRooms.delete(roomCode);
      return;
    }
    await query(`UPDATE game_rooms SET status = 'FINISHED', ended_at = now() WHERE id = $1`, [roomId]);
    this.broadcast(roomCode, 'game_ended', { roomId, winnerUserId });
    liveRooms.delete(roomCode);
  }
}

module.exports = { RoomManager, liveRooms };
