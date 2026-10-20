'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { manager, LudoError, BETS, CROWNS, CAPACITIES, COMMISSION_PERCENT, WAIT_MS } = require('./ludoManager');
const E = require('./ludoEngine');

// small per-user limiter for the money-moving endpoints (create / join / play / leave)
const hits = new Map();
function limit(req, res, next) {
  const key = String(req.user.id);
  const now = Date.now();
  const e = hits.get(key) && hits.get(key).reset > now ? hits.get(key) : { n: 0, reset: now + 10000 };
  e.n += 1;
  hits.set(key, e);
  if (e.n > 12) return res.status(429).json({ error: 'ብዙ ጥያቄ ተልኳል። ጥቂት ቆይተው ይሞክሩ።' });
  return next();
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
}, 30000).unref();

function fail(res, e) {
  if (e instanceof LudoError) return res.status(e.code === 'NOT_FOUND' ? 404 : 400).json({ error: e.userMessage, code: e.code });
  console.error('[ludo] route', e);
  return res.status(500).json({ error: 'Internal server error' });
}

const router = express.Router();
router.use(requireAuth);
router.use(async (req, res, next) => {
  try {
    await manager.init();
    next();
  } catch (e) {
    console.error('[ludo] init failed', e);
    res.status(503).json({ error: 'Ludo አገልግሎት ለጊዜው አይገኝም' });
  }
});

router.get('/config', (req, res) => {
  res.json({ bets: BETS, crowns: CROWNS, capacities: CAPACITIES, commissionPercent: COMMISSION_PERCENT, waitSeconds: WAIT_MS / 1000, rollSeconds: E.ROLL_MS / 1000, moveSeconds: E.MOVE_MS / 1000 });
});

router.get('/rooms', async (req, res) => {
  try {
    res.json({ ...(await manager.lobbyRooms()), mine: await manager.myRooms(req.user.id) });
  } catch (e) {
    fail(res, e);
  }
});

router.get('/rooms/:code', async (req, res) => {
  try {
    const state = await manager.publicState(String(req.params.code).toUpperCase());
    if (!state) return res.status(404).json({ error: 'ክፍሉ አልተገኘም' });
    if (!state.players.some((p) => p.userId5d === req.user.user_id_5d)) return res.status(403).json({ error: 'በዚህ ክፍል ውስጥ አይደሉም' });
    return res.json(state);
  } catch (e) {
    return fail(res, e);
  }
});

router.post('/rooms', limit, async (req, res) => {
  try {
    const code = await manager.createRoom(req.user.id, req.body || {});
    res.json({ code });
  } catch (e) {
    fail(res, e);
  }
});

router.post('/play', limit, async (req, res) => {
  try {
    res.json(await manager.playNow(req.user.id, req.body || {}));
  } catch (e) {
    fail(res, e);
  }
});

router.post('/rooms/:code/join', limit, async (req, res) => {
  try {
    res.json(await manager.joinRoom(req.user.id, String(req.params.code).toUpperCase()));
  } catch (e) {
    fail(res, e);
  }
});

router.post('/rooms/:code/leave', limit, async (req, res) => {
  try {
    await manager.leaveRoom(req.user.id, String(req.params.code).toUpperCase());
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

// ---- admin (existing admin auth) : GET /api/admin/ludo/overview ----
const admin = express.Router();
admin.use(requireAuth, requireAdmin);
admin.get('/overview', async (req, res) => {
  try {
    res.json(await manager.adminOverview());
  } catch (e) {
    fail(res, e);
  }
});

module.exports = { router, admin };
