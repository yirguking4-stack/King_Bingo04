const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { verifyInitData } = require('../utils/telegramAuth');
const userModel = require('../models/userModel');
const crypto = require('crypto');
const { rateLimit } = require('../middleware/rateLimit');
const { closeRegisterPrompts } = require('../utils/registerPrompt');
const { requireAuth } = require('../middleware/auth');
const { ensureAgentTables } = require('../utils/agentTables');
const { verifyCode } = require('../utils/agents');

const router = express.Router();

router.post('/telegram', async (req, res) => {
  const { initData } = req.body;
  const { valid, user, startParam } = verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN);

  if (!valid || !user) {
    return res.status(401).json({ error: 'Could not verify Telegram identity' });
  }

  if (!user.username) {
    return res.status(403).json({
      error: 'USERNAME_REQUIRED',
      message: 'ይሄንን Bot ለመጠቀም የቴሌግራም @username ያስፈልጋል። እባክዎ በቴሌግራም ፕሮፋይል ቅንብር ውስጥ ➝"Add username" የሚለውን ነክተው username ያስቀምጡና /start ብለው እንደገና ይላኩ። ወይም ካስቸገሮት በዚህ username እርዳታ ይጠይቁ @KingSupport07\n\nA Telegram @username is required to use this bot. Open your profile settings, select \'Add username\', and send /start once more. If you run into any issues, contact @KingSupport07 for assistance.',
    });
  }

  const existing = await userModel.findByTelegramId(user.id);
  if (!existing) {
    return res.status(200).json({
      needsRegistration: true,
      telegramProfile: {
        telegramId: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
      },
      referralCandidate: startParam || null,
    });
  }

  const token = jwt.sign(
    { sub: existing.id, telegram_id: existing.telegram_id, user_id_5d: existing.user_id_5d, is_admin: existing.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  return res.json({
    needsRegistration: false,
    token,
    user: {
      id: existing.id,
      userId5d: existing.user_id_5d,
      username: existing.username,
      isAdmin: existing.is_admin,
    },
  });
});

router.post('/register', async (req, res) => {
  try {
    const { initData, phoneNumber, referredBy } = req.body;
    const { valid, user } = verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN);

    if (!valid || !user) return res.status(401).json({ error: 'Could not verify Telegram identity' });
    if (!user.username) {
      return res.status(403).json({
        error: 'USERNAME_REQUIRED',
        message: 'ይሄንን Bot ለመጠቀም የቴሌግራም @username ያስፈልጋል። እባክዎ በቴሌግራም ፕሮፋይል ቅንብር ውስጥ ➝"Add username" የሚለውን ነክተው username ያስቀምጡና /start ብለው እንደገና ይላኩ። ወይም ካስቸገሮት በዚህ username እርዳታ ይጠይቁ @KingSupport07\n\nA Telegram @username is required to use this bot. Open your profile settings, select \'Add username\', and send /start once more. If you run into any issues, contact @KingSupport07 for assistance.',
      });
    }

    const cleanPhone = String(phoneNumber || '').replace(/[\s-]/g, '');
    if (!/^(09|07)[0-9]{8}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'ትክክለኛ የስልክ ቁጥር ያስገቡ (ለምሳሌ 0912345678)።' });
    }

    const already = await userModel.findByTelegramId(user.id);
    if (already) return res.status(409).json({ error: 'ቀድሞ ተመዝግበዋል።' });

    const phoneTaken = await query('SELECT 1 FROM users WHERE phone_number = $1', [cleanPhone]);
    if (phoneTaken.rowCount > 0) {
      return res.status(409).json({ error: 'ይህ ስልክ ቁጥር ቀድሞ ተመዝግቧል።' });
    }

    // Invitation ID is optional, but if the player typed one it must be a real Player ID.
    let cleanReferral = null;
    const typedReferral = String(referredBy ?? '').trim();
    if (typedReferral) {
      if (!/^[0-9]{5}$/.test(typedReferral)) {
        return res.status(400).json({ error: 'Invitation ID 5 ቁጥር መሆን አለበት (ለምሳሌ 00005)።' });
      }
      const inviter = await userModel.findByUserId5d(typedReferral);
      if (!inviter) {
        return res.status(400).json({ error: `Invitation ID ${typedReferral} አልተገኘም። ትክክለኛውን ያስገቡ ወይም ባዶ ይተዉት።` });
      }
      cleanReferral = typedReferral;
    }

    const newUser = await userModel.registerUser({
      telegramId: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      phoneNumber: cleanPhone,
      referredBy: cleanReferral,
    });

    const token = jwt.sign(
      { sub: newUser.id, telegram_id: newUser.telegram_id, user_id_5d: newUser.user_id_5d, is_admin: false },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(201).json({
      message: `Registered Successfully! Your Player ID: ${newUser.user_id_5d}`,
      token,
      user: { id: newUser.id, userId5d: newUser.user_id_5d, username: newUser.username, isAdmin: false },
    });
  } catch (err) {
    console.error('[auth/register]', err);
    return res.status(500).json({ error: 'ምዝገባው አልተሳካም። እባክዎ እንደገና ይሞክሩ።' });
  }
});

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function adminCodeOk(code) {
  return Boolean(process.env.ADMIN_BOOTSTRAP_CODE) && safeEqual(code, process.env.ADMIN_BOOTSTRAP_CODE);
}

function allowedAdminTelegramIds() {
  return (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

/**
 * Called when the player taps "Back to home" on the "ምዝገባው ተጠናቋል ✅" screen.
 * Only now is the "ተመዝገብ" button removed from the bot chat.
 */
router.post('/registration-done', requireAuth, (req, res) => {
  closeRegisterPrompts(req.user.telegram_id);
  res.json({ ok: true });
});

/**
 * Self-promotion to admin from the Mini App. Three locks must ALL pass:
 *  1) ALLOW_ADMIN_BOOTSTRAP=true (switch it off after you became admin)
 *  2) your Telegram ID is listed in ADMIN_TELEGRAM_IDS
 *  3) the secret ADMIN_BOOTSTRAP_CODE is correct
 */
router.post('/become-admin', adminLimiter, async (req, res) => {
  const { initData, code } = req.body;
  const { valid, user } = verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN);

  if (!valid || !user) return res.status(401).json({ error: 'Could not verify Telegram identity' });

  // already an admin: nothing to do (the Admin Panel is the web page, log in there)
  const current = await userModel.findByTelegramId(user.id);
  if (current && current.is_admin) {
    return res.json({ message: `✅ Player ID ${current.user_id_5d} አስቀድሞ Admin ነው። ወደ Admin Panel (ድር አድራሻው) በ Player ID እና በ Admin Code ይግቡ።` });
  }

  if (process.env.ALLOW_ADMIN_BOOTSTRAP !== 'true') {
    return res.status(403).json({ error: 'Admin የመሆን አማራጭ አሁን ዝግ ነው። Admin ለመሆን የስርዓቱን ባለቤት ያነጋግሩ።' });
  }
  if (!allowedAdminTelegramIds().includes(String(user.id))) {
    return res.status(403).json({ error: 'ይህ የቴሌግራም አካውንት admin እንዲሆን አልተፈቀደም።' });
  }
  if (!adminCodeOk(code)) {
    return res.status(403).json({ error: 'የገባው ኮድ ትክክል አይደለም።' });
  }

  const existing = await userModel.findByTelegramId(user.id);
  if (!existing) {
    return res.status(404).json({ error: 'መጀመሪያ በ Mini App ይመዝገቡ፣ ከዚያ እንደገና ይሞክሩ።' });
  }

  await query('UPDATE users SET is_admin = TRUE, updated_at = now() WHERE id = $1', [existing.id]);

  await query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, 'ADMIN_SELF_BOOTSTRAP', 'user', $1, '{}')`,
    [existing.id]
  );

  res.json({ message: `እንኳን ደስ አለዎት! Player ID ${existing.user_id_5d} አሁን Admin ሆኗል።` });
});

/**
 * Admin panel login: Player ID + secret admin code. The account must already
 * have is_admin = TRUE and be ACTIVE. Same error for every failure so nobody
 * can discover which Player IDs are admins.
 */
router.post('/admin-login-code', adminLimiter, async (req, res) => {
  const { playerId, code } = req.body;
  const fail = () => res.status(403).json({ error: 'Player ID ወይም ኮድ ትክክል አይደለም።' });

  if (!adminCodeOk(code)) return fail();

  const user = await userModel.findByUserId5d(String(playerId || '').trim());
  if (!user || !user.is_admin || user.status !== 'ACTIVE') return fail();

  const token = jwt.sign(
    { sub: user.id, telegram_id: user.telegram_id, user_id_5d: user.user_id_5d, is_admin: true },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({ token, role: 'admin', user: { userId5d: user.user_id_5d, username: user.username } });
});

/**
 * Admin-panel login for AGENTS (Player ID + the personal access code the admin generated).
 * An agent can only reach the deposit/withdrawal pages (see routes/agentRoutes.js).
 * Same error for every failure.
 */
router.post('/agent-login-code', adminLimiter, async (req, res) => {
  const { playerId, code } = req.body;
  const fail = () => res.status(403).json({ error: 'Player ID ወይም ኮድ ትክክል አይደለም።' });
  try {
    const user = await userModel.findByUserId5d(String(playerId || '').trim());
    if (!user || user.status !== 'ACTIVE') return fail();
    await ensureAgentTables();
    const a = await query('SELECT code_salt, code_hash FROM agents WHERE user_id = $1 AND active = TRUE', [user.id]);
    if (!a.rowCount || !verifyCode(code, a.rows[0].code_salt, a.rows[0].code_hash)) return fail();

    const token = jwt.sign(
      { sub: user.id, telegram_id: user.telegram_id, user_id_5d: user.user_id_5d, is_admin: false, role: 'agent' },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    return res.json({ token, role: 'agent', user: { userId5d: user.user_id_5d, username: user.username } });
  } catch (err) {
    console.error('[auth/agent-login]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
