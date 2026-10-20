'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { query } = require('../config/db');
const { ensureMenuBannerTable, detectMime, getBanner } = require('../utils/menuBanner');

// ---- admin: /api/admin/menu-banner ----
const admin = express.Router();
admin.use(requireAuth, requireAdmin);

admin.get('/', async (req, res) => {
  try {
    const b = await getBanner();
    if (!b) return res.json({ custom: false });
    return res.json({ custom: true, updatedAt: b.updated_at, sizeKb: Math.round(b.data.length / 1024), dataUrl: `data:${b.mime};base64,${b.data.toString('base64')}` });
  } catch (e) {
    console.error('[menu-banner] get', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// the picture itself is sent as the raw request body (Content-Type image/jpeg or image/png)
admin.put('/', express.raw({ type: ['image/jpeg', 'image/png'], limit: '5mb' }), async (req, res) => {
  try {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Send a JPG or PNG picture (max 5 MB)' });
    const mime = detectMime(buf);
    if (!mime) return res.status(400).json({ error: 'The file is not a valid JPG or PNG picture' });
    await ensureMenuBannerTable();
    await query(
      `INSERT INTO menu_banner (id, mime, data, updated_at) VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE SET mime = $1, data = $2, updated_at = now()`,
      [mime, buf]
    );
    return res.json({ ok: true, sizeKb: Math.round(buf.length / 1024) });
  } catch (e) {
    console.error('[menu-banner] put', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

admin.delete('/', async (req, res) => {
  try {
    await ensureMenuBannerTable();
    await query('DELETE FROM menu_banner WHERE id = 1');
    return res.json({ ok: true });
  } catch (e) {
    console.error('[menu-banner] delete', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- bot (shared secret): /api/bot/menu-banner ----
const bot = express.Router();
bot.get('/version', async (req, res) => {
  try {
    const b = await getBanner();
    res.json({ version: b ? new Date(b.updated_at).getTime() : 0 });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
bot.get('/', async (req, res) => {
  try {
    const b = await getBanner();
    if (!b) return res.status(404).json({ error: 'No custom banner' });
    res.set('Content-Type', b.mime);
    res.set('x-banner-version', String(new Date(b.updated_at).getTime()));
    return res.send(b.data);
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { admin, bot };
