'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { manager, DamaError, COMMISSION_PERCENT, payoutFor, TURN_OPTIONS } = require('./damaManager');

// per-user limiter for the money-moving endpoints
const hits = new Map();
function limit(req, res, next) {
  const key = String(req.user.id);
  const now = Date.now();
  const e = hits.get(key) && hits.get(key).reset > now ? hits.get(key) : { n: 0, reset: now + 10000 };
  e.n += 1;
  hits.set(key, e);
  if (e.n > 10) return res.status(429).json({ error: 'ብዙ ጥያቄ ተልኳል። ጥቂት ቆይተው ይሞክሩ።' });
  return next();
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
}, 30000).unref();

function fail(res, e) {
  if (e instanceof DamaError) return res.status(e.code === 'NOT_FOUND' ? 404 : 400).json({ error: e.userMessage, code: e.code });
  console.error('[dama] route', e);
  return res.status(500).json({ error: 'Internal server error' });
}

const router = express.Router();
router.use(requireAuth);
router.use(async (req, res, next) => {
  try {
    await manager.init();
    next();
  } catch (e) {
    console.error('[dama] init failed', e);
    res.status(503).json({ error: 'King Dama አገልግሎት ለጊዜው አይገኝም' });
  }
});

router.get('/config', async (req, res) => {
  try {
    const cfg = await manager.settings();
    res.json({
      enabled: cfg.enabled,
      bets: cfg.bets.map((bet) => ({ bet, ...payoutFor(bet) })),
      commissionPercent: COMMISSION_PERCENT,
      turnSeconds: cfg.turnSeconds,
      waitSeconds: cfg.waitSeconds,
    });
  } catch (e) {
    fail(res, e);
  }
});

router.get('/active', async (req, res) => {
  try {
    res.json({ mine: await manager.myActive(req.user.id) });
  } catch (e) {
    fail(res, e);
  }
});

router.get('/history', async (req, res) => {
  try {
    res.json({ items: await manager.history(req.user.id) });
  } catch (e) {
    fail(res, e);
  }
});

// open rooms for the lobby list (+ my own active rooms)
router.get('/rooms', async (req, res) => {
  try {
    res.json({ ...(await manager.lobbyRooms()), mine: await manager.myActive(req.user.id) });
  } catch (e) {
    fail(res, e);
  }
});

// create a new open room with my stake
router.post('/rooms', limit, async (req, res) => {
  try {
    res.json(await manager.createRoom(req.user.id, { bet: (req.body || {}).bet }));
  } catch (e) {
    fail(res, e);
  }
});

// join a specific open room (the second player starts the game)
router.post('/rooms/:code/join', limit, async (req, res) => {
  try {
    res.json(await manager.joinRoom(req.user.id, String(req.params.code).toUpperCase()));
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

// Start searching for an opponent with the same stake (reserves the stake)
router.post('/play', limit, async (req, res) => {
  try {
    res.json(await manager.playNow(req.user.id, { bet: (req.body || {}).bet }));
  } catch (e) {
    fail(res, e);
  }
});

// Cancel Search (refund, no commission)
router.post('/rooms/:code/cancel', limit, async (req, res) => {
  try {
    await manager.cancelSearch(req.user.id, String(req.params.code).toUpperCase());
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

// ---- admin: /api/admin/dama/* ----
const admin = express.Router();
admin.use(requireAuth, requireAdmin);
admin.get('/overview', async (req, res) => {
  try {
    await manager.init();
    res.json({ ...(await manager.adminOverview()), turnOptions: TURN_OPTIONS });
  } catch (e) {
    fail(res, e);
  }
});
admin.put('/config', async (req, res) => {
  try {
    await manager.init();
    res.json(await manager.saveSettings(req.user.id, req.body || {}));
  } catch (e) {
    fail(res, e);
  }
});
admin.post('/rooms/:code/void', async (req, res) => {
  try {
    await manager.init();
    await manager.adminVoid(req.user.id, String(req.params.code).toUpperCase(), String((req.body || {}).reason || '').slice(0, 300));
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

module.exports = { router, admin };
