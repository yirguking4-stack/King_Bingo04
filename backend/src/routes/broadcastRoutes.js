const express = require('express');
const { query } = require('../config/db');
const router = express.Router();

router.get('/recipients', async (req, res) => {
  const secret = req.headers['x-bot-secret'];
  if (!secret || secret !== process.env.BOT_INTERNAL_SECRET) return res.status(401).json({ error: 'Invalid bot secret' });
  const r = await query("SELECT telegram_id FROM users WHERE status = 'ACTIVE'");
  res.json({ ids: r.rows.map((x) => String(x.telegram_id)) });
});

module.exports = router;
