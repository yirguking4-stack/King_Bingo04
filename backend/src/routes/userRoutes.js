const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/me', requireAuth, async (req, res) => {
  const walletRes = await query('SELECT balance, locked_balance FROM wallets WHERE user_id = $1', [req.user.id]);
  const gameCountRes = await query(
    `SELECT COUNT(*) FROM game_entries WHERE user_id = $1`,
    [req.user.id]
  );
  const winsRes = await query(
    `SELECT COUNT(*) FROM game_entries WHERE user_id = $1 AND is_winner = TRUE`,
    [req.user.id]
  );

  res.json({
    userId5d: req.user.user_id_5d,
    username: req.user.username,
    isAdmin: req.user.is_admin,
    wallet: walletRes.rows[0],
    gamesPlayed: Number(gameCountRes.rows[0].count),
    gamesWon: Number(winsRes.rows[0].count),
  });
});

router.get('/me/transactions', requireAuth, async (req, res) => {
  const result = await query(
    `SELECT id, public_id, type, amount, status, reference_note, created_at, reviewed_at
     FROM transactions
     WHERE user_id = $1 AND type IN ('VIRTUAL_DEPOSIT', 'VIRTUAL_WITHDRAWAL')
     ORDER BY created_at DESC LIMIT 100`,
    [req.user.id]
  );
  res.json(result.rows);
});

router.get('/me/referrals', requireAuth, async (req, res) => {
  const result = await query(
    `SELECT user_id_5d, username, created_at FROM users WHERE referred_by = $1 ORDER BY created_at DESC`,
    [req.user.user_id_5d]
  );
  res.json(result.rows);
});

module.exports = router;
