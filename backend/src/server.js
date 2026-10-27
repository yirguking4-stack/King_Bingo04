require('dotenv').config();
require('express-async-errors'); // async route errors -> error middleware (no more crashes)
const http = require('http');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const walletRoutes = require('./routes/walletRoutes');
const gameRoutes = require('./routes/gameRoutes');
const adminRoutes = require('./routes/adminRoutes');
const botRoutes = require('./routes/botRoutes');
const { createWsServer } = require('./websocket/wsServer');

const app = express();
app.set('trust proxy', 1); // Render is behind a proxy (needed for real client IPs / rate limiting)

// CORS_ORIGINS = comma separated Vercel URLs (no trailing slash). Empty = allow all.
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));
app.use(express.json({ limit: '1mb' })); // deposit screenshots arrive as compressed base64

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'king-bingo-backend' }));

const supportRouter = require('./support/supportRoutes.cjs');
app.use('/api/support', supportRouter);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/games', gameRoutes);
const ludoRoutes = require('./ludo/ludoRoutes');
app.use('/api/ludo', ludoRoutes.router);
const damaRoutes = require('./dama/damaRoutes');
app.use('/api/dama', damaRoutes.router);
const menuBanner = require('./routes/menuBannerRoutes');
app.use('/api/admin/menu-banner', menuBanner.admin);
const agentRoutes = require('./routes/agentRoutes');
app.use('/api/admin/agents', agentRoutes.admin);
app.use('/api/agent', agentRoutes.staff);
app.use('/api/admin/dama', damaRoutes.admin);
app.use('/api/admin/ludo', ludoRoutes.admin); // before /api/admin so the Ludo admin view is reachable
app.use('/api/admin', adminRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/broadcast', require('./routes/broadcastRoutes'));
app.use('/api/appointments', require('./routes/appointmentRoutes'));

app.use((err, req, res, next) => {
  console.error('[unhandled error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);
const { roomManager, broadcast } = createWsServer(server);

// expose to REST routes that need to trigger real-time broadcasts
app.locals.roomManager = roomManager;
app.locals.broadcast = broadcast;

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`[king-bingo] backend listening on port ${PORT}`);
  console.log(`[king-bingo] WebSocket endpoint: ws://localhost:${PORT}/ws`);

  // rooms left open by a restart/crash: cancel them and refund players
  roomManager.recoverStuckRooms().catch((err) => console.error('[recover] failed', err));

  // Ludo: create its tables (idempotent) and restore waiting/running games with their timers
  require('./ludo/ludoManager').manager.init().catch((err) => console.error('[ludo] init failed', err));

  // King Dama: create its tables (idempotent), restore waiting/running matches and their persisted deadlines
  require('./dama/damaManager').manager.init().catch((err) => console.error('[dama] init failed', err));
});
