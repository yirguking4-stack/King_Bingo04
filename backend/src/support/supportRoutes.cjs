'use strict';
// King Bingo - Support requests (NO database).
// Verifies the Telegram Mini App initData, then forwards the request to the
// admin through the bot. Works in both CommonJS and ESM projects (.cjs file).

const crypto = require('crypto');
const express = require('express');

const CATEGORIES = {
  reg: 'ከምዝገባ ጋር ለተያያዘ እገዛ',
  dep: 'ገንዘብ ከማስገባት (Deposit) ጋር ለተያያዘ እገዛ',
  wd: 'ገንዘብ ከማውጣት (Withdraw) ጋር ለተያያዘ እገዛ',
  dep_missing: 'ያስገባሁት ገንዘብ ወደ ሂሳቤ አልገባም',
  wd_missing: 'ያወጣሁት ገንዘብ አልደረሰኝም',
  bingo: 'በ Bingo ጨዋታ ወቅት የገጠመኝ ችግር',
  ludo_dama: 'በ Ludo / Dama ጨዋታ የገጠመኝ ችግር',
  bonus: 'ስለ ቦነስ እና ሽልማት',
  account: 'የአካውንት ወይም የስልክ ቁጥር ለውጥ',
  rules: 'ስለ ጨዋታ ህጎች እና አሸናፊነት',
  other: 'ሌሎች / Other',
};

const RATE_MS = 60 * 1000; // one request per player per minute (in memory only)
const lastSent = new Map();

function botToken() {
  return process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
}

function adminChat() {
  return (
    process.env.SUPPORT_CHAT_ID ||
    process.env.ADMIN_CHAT_ID ||
    process.env.ADMIN_TELEGRAM_ID ||
    process.env.ADMIN_ID ||
    ''
  );
}

// Returns the Telegram user object when initData is genuine, otherwise null.
function verifyInitData(initData, token) {
  if (!initData || !token) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 24 * 3600) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user && user.id ? user : null;
  } catch (e) {
    return null;
  }
}

const router = express.Router();
router.use(express.json({ limit: '10kb' }));

router.post('/', async (req, res) => {
  try {
    const { initData, category, message } = req.body || {};
    const token = botToken();
    const chat = adminChat();
    if (!token || !chat) {
      return res.status(503).json({ ok: false, error: 'support_not_configured' });
    }

    const user = verifyInitData(String(initData || ''), token);
    if (!user) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const label = CATEGORIES[category];
    if (!label) return res.status(400).json({ ok: false, error: 'bad_category' });

    const note = typeof message === 'string' ? message.trim().slice(0, 500) : '';
    if (category === 'other' && note.length < 3) {
      return res.status(400).json({ ok: false, error: 'message_required' });
    }

    const now = Date.now();
    const prev = lastSent.get(user.id) || 0;
    if (now - prev < RATE_MS) {
      return res.status(429).json({
        ok: false,
        error: 'too_fast',
        retryAfter: Math.ceil((RATE_MS - (now - prev)) / 1000),
      });
    }

    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || '—';
    const handle = user.username ? ` (@${user.username})` : '';
    const text =
      '🆘 አዲስ የእገዛ ጥያቄ\n\n' +
      `👤 ${name}${handle}\n` +
      `🆔 Telegram ID: ${user.id}\n` +
      `📂 ምድብ: ${label}\n` +
      `✉️ መልዕክት: ${note || '—'}`;

    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    });
    if (!r.ok) {
      console.error('[support] telegram sendMessage failed, status', r.status);
      return res.status(502).json({ ok: false, error: 'telegram_failed' });
    }

    lastSent.set(user.id, now);
    if (lastSent.size > 5000) {
      for (const [id, t] of lastSent) if (now - t > RATE_MS) lastSent.delete(id);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[support] error:', e && e.message);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

module.exports = router;
module.exports.verifyInitData = verifyInitData;
