const express = require('express');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const { query } = require('../config/db');
const { ensureBotTables } = require('../utils/botTables');

const router = express.Router();

/**
 * These endpoints are called only by the Telegram bot process (server-to-
 * server), never by the Mini App or a browser. Trust comes from Telegram's
 * Bot API already having verified the update server-side, plus a shared
 * secret header — this is a different trust boundary than the Mini App's
 * initData-signature verification used in authRoutes.js.
 */
function requireBotSecret(req, res, next) {
  const secret = req.headers['x-bot-secret'];
  if (!secret || secret !== process.env.BOT_INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Invalid bot secret' });
  }
  next();
}

router.use(requireBotSecret);
router.use('/menu-banner', require('./menuBannerRoutes').bot);

router.get('/user/:telegramId', async (req, res) => {
  try {
    const user = await userModel.findByTelegramId(req.params.telegramId);
    if (!user) return res.status(404).json({ exists: false });
    res.json({ exists: true, userId5d: user.user_id_5d, username: user.username, status: user.status });
  } catch (err) {
    console.error('[botRoutes] user lookup failed:', err.message);
    res.status(500).json({ error: 'lookup failed' });
  }
});

router.post('/register', async (req, res) => {
  const { telegramId, username, firstName, lastName, phoneNumber, referredBy } = req.body;

  if (!username) {
    return res.status(400).json({
      error: 'USERNAME_REQUIRED',
      message:
        'Access Blocked: A Telegram @username is required to use this app. Please set a username in your Telegram profile settings and type /start again.',
    });
  }
  if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required' });

  const already = await userModel.findByTelegramId(telegramId);
  if (already) return res.status(409).json({ error: 'Already registered', userId5d: already.user_id_5d });

  let cleanReferral = null;
  if (referredBy && /^[0-9]{5}$/.test(referredBy)) cleanReferral = referredBy;

  const newUser = await userModel.registerUser({
    telegramId,
    username,
    firstName,
    lastName,
    phoneNumber,
    referredBy: cleanReferral,
  });

  res.status(201).json({ userId5d: newUser.user_id_5d });
});

// the bot tells us which "ተመዝገብ" message it sent, so we can remove the button after registration
router.post('/register-prompt', async (req, res) => {
  const { telegramId, messageId } = req.body;
  if (!telegramId || !messageId) return res.status(400).json({ error: 'telegramId and messageId required' });
  try {
    await ensureBotTables();
    await query(
      'INSERT INTO bot_register_prompts (telegram_id, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [telegramId, messageId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[botRoutes] register-prompt failed:', err.message);
    res.status(500).json({ error: 'could not store prompt' });
  }
});

const ALERTS_PER_PAGE = 5;

// archived request alerts for the "📋 የሂሳብ እንቅስቃሴዎች" button (admins only)
router.get('/admin-alerts', async (req, res) => {
  const telegramId = req.query.telegramId;
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const admin = await userModel.findByTelegramId(telegramId);
  let allowed = Boolean(admin) && admin.status === 'ACTIVE' && admin.is_admin === true;
  if (!allowed && admin && admin.status === 'ACTIVE') allowed = Boolean(await require('../utils/agents').activeAgentOf(admin.id));
  if (!allowed) {
    return res.status(403).json({ error: 'Not an admin' });
  }
  await ensureBotTables();
  const total = Number(
    (await query('SELECT COUNT(*) AS c FROM admin_alerts WHERE admin_telegram_id = $1 AND archived = TRUE', [telegramId])).rows[0].c
  );
  const rows = await query(
    `SELECT body, kind, created_at FROM admin_alerts
      WHERE admin_telegram_id = $1 AND archived = TRUE
      ORDER BY id DESC LIMIT $2 OFFSET $3`,
    [telegramId, ALERTS_PER_PAGE, page * ALERTS_PER_PAGE]
  );
  res.json({ total, page, perPage: ALERTS_PER_PAGE, items: rows.rows });
});

// Approve / Reject pressed in a Telegram alert. The person is identified by his Telegram account
// (Telegram verified the update). Only an admin or an ACTIVE agent may do this, and only for
// deposits / withdrawals he is allowed to handle - same rules as the admin panel's Transactions page.
router.post('/review', async (req, res) => {
  try {
    const { telegramId, transactionId, decision } = req.body || {};
    const id = parseInt(transactionId, 10);
    if (!Number.isInteger(id) || !['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'Invalid request' });
    const { staffOf, canHandleTx } = require('./agentRoutes');
    const walletModel = require('../models/walletModel');
    const { notifyReviewResult } = require('../utils/balanceNotify');
    const user = await userModel.findByTelegramId(telegramId);
    const staff = await staffOf(user);
    if (!staff) return res.status(403).json({ error: 'ይህን ለማድረግ ፈቃድ የለዎትም።' });
    const ok = await canHandleTx(staff, user, id);
    if (!ok.ok) return res.status(ok.status).json({ error: ok.error });
    try {
      const tx = await walletModel.reviewTransaction(id, user.id, decision);
      notifyReviewResult(tx, tx.notices || []); // tell the player (fire-and-forget)
      return res.json({ ok: true, status: tx.status, by: user.username });
    } catch (err) {
      const done = /already reviewed/i.test(err.message);
      return res.status(done ? 409 : 400).json({ error: done ? 'ይህ ጥያቄ አስቀድሞ ተስተናግዷል።' : err.message });
    }
  } catch (err) {
    console.error('[botRoutes] review failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
