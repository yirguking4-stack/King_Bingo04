const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { CARD_COUNT, CARD_POOL } = require('../game/bingoEngine');

const router = express.Router();

router.get('/stake-tiers', requireAuth, async (req, res) => {
  const gameType = (req.query.game || 'BINGO').toUpperCase();

  const result = await query(
    `
    SELECT
      st.*,
      COALESCE(pc.player_count, 0) AS active_players
    FROM stake_tiers st
    LEFT JOIN (
      SELECT gr.stake_tier_id, COUNT(ge.id) AS player_count
      FROM game_rooms gr
      JOIN game_entries ge ON ge.game_room_id = gr.id
      WHERE gr.status IN ('WAITING', 'COUNTDOWN', 'IN_PROGRESS')
      GROUP BY gr.stake_tier_id
    ) pc ON pc.stake_tier_id = st.id
    WHERE st.game_type = $1
    ORDER BY st.entry_credits ASC
    `,
    [gameType]
  );
  res.json(result.rows);
});

// The 150 fixed cards (same for everybody, so the client can cache them).
router.get('/cards', requireAuth, (req, res) => {
  res.json({ count: CARD_COUNT, cards: CARD_POOL });
});

// Which card numbers are already taken in the table the player would join.
router.get('/taken-cards', requireAuth, async (req, res) => {
  const stakeTierId = Number(req.query.stakeTierId);
  if (!Number.isInteger(stakeTierId)) return res.status(400).json({ error: 'stakeTierId required' });

  // a game already running at this stake: the table is closed until it ends
  const running = await query(
    `SELECT id, room_code FROM game_rooms WHERE stake_tier_id = $1 AND status = 'IN_PROGRESS' ORDER BY created_at ASC LIMIT 1`,
    [stakeTierId]
  );
  if (running.rowCount > 0) {
    const runEntries = await query('SELECT user_id, card_id FROM game_entries WHERE game_room_id = $1', [running.rows[0].id]);
    const myRun = runEntries.rows.find((r) => String(r.user_id) === String(req.user.id));
    return res.json({
      roomCode: running.rows[0].room_code,
      taken: [],
      joined: myRun ? { roomCode: running.rows[0].room_code, cardId: myRun.card_id } : null,
      inProgress: { players: runEntries.rowCount, capacity: CARD_COUNT },
    });
  }

  const roomRes = await query(
    `SELECT id, room_code, status FROM game_rooms
     WHERE stake_tier_id = $1 AND status IN ('WAITING', 'COUNTDOWN')
     ORDER BY created_at ASC LIMIT 1`,
    [stakeTierId]
  );
  if (roomRes.rowCount === 0) return res.json({ roomCode: null, taken: [], joined: null, inProgress: null });

  const room = roomRes.rows[0];
  const entries = await query('SELECT user_id, card_id FROM game_entries WHERE game_room_id = $1', [room.id]);
  const taken = entries.rows.map((r) => r.card_id).filter((n) => n != null);
  const mine = entries.rows.find((r) => r.user_id === req.user.id || String(r.user_id) === String(req.user.id));

  res.json({
    roomCode: room.room_code,
    taken,
    joined: mine ? { roomCode: room.room_code, cardId: mine.card_id } : null,
    inProgress: null,
  });
});

router.post('/join', requireAuth, async (req, res) => {
  const stakeTierId = Number(req.body.stakeTierId);
  const cardId = Number(req.body.cardId);
  const roomManager = req.app.locals.roomManager;

  if (!Number.isInteger(stakeTierId)) return res.status(400).json({ error: 'stakeTierId required' });
  if (!Number.isInteger(cardId) || cardId < 1 || cardId > CARD_COUNT) {
    return res.status(400).json({ error: `Pick a card between 1 and ${CARD_COUNT}` });
  }

  const tierRes = await query('SELECT id FROM stake_tiers WHERE id = $1', [stakeTierId]);
  if (tierRes.rowCount === 0) return res.status(404).json({ error: 'Table not found' });

  // same stake, game already running: wait for it to finish (other stakes stay open)
  const running = await query(
    `SELECT 1 FROM game_rooms WHERE stake_tier_id = $1 AND status = 'IN_PROGRESS' LIMIT 1`,
    [stakeTierId]
  );
  if (running.rowCount > 0) {
    return res.status(409).json({ error: 'በዚህ stake ጨዋታ እየተካሄደ ነው። እስኪጠናቀቅ ይጠብቁ ወይም ሌላ stake ይምረጡ።', code: 'GAME_IN_PROGRESS' });
  }

  try {
    const room = await roomManager.getOrCreateWaitingRoom(stakeTierId);
    const result = await roomManager.joinRoom(room.id, req.user.id, cardId);

    req.app.locals.broadcast(room.room_code, 'player_joined', {
      userId5d: req.user.user_id_5d,
      username: req.user.username,
      playerCount: result.playerCount,
      potTotal: result.room.pot_total,
    });

    if (result.room.status === 'WAITING') {
      roomManager.scheduleWaitingTimeout(room.room_code, room.id);
    } else if (result.room.status === 'COUNTDOWN') {
      roomManager.clearWaitingTimer(room.room_code);
      roomManager.scheduleGameStart(room.room_code, room.id);
    }

    res.status(201).json({
      roomCode: room.room_code,
      roomStatus: result.room.status,
      potTotal: result.room.pot_total,
      cardId: result.cardId,
      card: result.card,
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') return res.status(400).json({ error: err.message });
    if (err.code === 'CARD_TAKEN' || (err.code === '23505' && err.constraint === 'uq_game_entries_room_card')) {
      return res.status(409).json({ error: 'This card was just taken by another player. Please pick a different card.', code: 'CARD_TAKEN' });
    }
    if (err.code === 'INVALID_CARD') return res.status(400).json({ error: err.message });
    if (err.message === 'Already joined this room') return res.status(409).json({ error: err.message, code: 'ALREADY_JOINED' });
    if (err.message === 'Room is no longer accepting players') {
      return res.status(409).json({ error: 'This game has just started. Please choose your card again for the next game.', code: 'ROOM_CLOSED' });
    }
    console.error('[games/join]', err);
    res.status(500).json({ error: 'Could not join game room' });
  }
});

router.get('/room/:roomCode', requireAuth, async (req, res) => {
  const roomRes = await query('SELECT * FROM game_rooms WHERE room_code = $1', [req.params.roomCode]);
  if (roomRes.rowCount === 0) return res.status(404).json({ error: 'Room not found' });
  const room = roomRes.rows[0];

  const entryRes = await query(
    'SELECT card_id, card_numbers, marked_numbers, is_winner, prize_credits FROM game_entries WHERE game_room_id = $1 AND user_id = $2',
    [room.id, req.user.id]
  );

  const tierRes = await query('SELECT entry_credits FROM stake_tiers WHERE id = $1', [room.stake_tier_id]);
  const stake = tierRes.rowCount ? Number(tierRes.rows[0].entry_credits) : null;

  const countRes = await query('SELECT COUNT(*) AS c FROM game_entries WHERE game_room_id = $1', [room.id]);
  const playerCount = Number(countRes.rows[0].c);

  res.json({ room, stake, playerCount, myEntry: entryRes.rows[0] || null });
});

router.get('/history', requireAuth, async (req, res) => {
  const result = await query(
    `SELECT gr.room_code, gr.status, gr.pot_total, gr.winner_pattern, gr.ended_at,
            ge.is_winner, ge.prize_credits
     FROM game_entries ge
     JOIN game_rooms gr ON gr.id = ge.game_room_id
     WHERE ge.user_id = $1
     ORDER BY gr.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json(result.rows);
});

module.exports = router;
