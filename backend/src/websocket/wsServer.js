const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');
const { RoomManager } = require('../game/roomManager');
const { query } = require('../config/db');
const { maskUsername } = require('../utils/validators');
const { manager: ludo } = require('../ludo/ludoManager');
const { manager: dama } = require('../dama/damaManager');

// roomCode -> Set of { ws, userId, userId5d }
const roomSockets = new Map();

function addSocketToRoom(roomCode, socketEntry) {
  if (!roomSockets.has(roomCode)) roomSockets.set(roomCode, new Set());
  roomSockets.get(roomCode).add(socketEntry);
}

function removeSocketFromRoom(roomCode, socketEntry) {
  const set = roomSockets.get(roomCode);
  if (!set) return;
  set.delete(socketEntry);
  if (set.size === 0) {
    roomSockets.delete(roomCode);
    chatHistory.delete(roomCode); // chat is temporary: gone when the room is empty
  }
}

// ---- in-room chat (temporary, in memory only) ----
const CHAT_MAX_LENGTH = 60;
const CHAT_COOLDOWN_MS = 2000;
const CHAT_HISTORY_SIZE = 30;
const chatHistory = new Map(); // roomCode -> [{ id, username, userId5d, text }]
let chatSeq = 0;

function cleanChatText(raw) {
  return [...String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()]
    .slice(0, CHAT_MAX_LENGTH)
    .join('');
}

function broadcast(roomCode, eventType, payload) {
  const set = roomSockets.get(roomCode);
  if (!set) return;
  const message = JSON.stringify({ type: eventType, payload, ts: Date.now() });
  for (const { ws } of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  }
}

function createWsServer(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });
  const roomManager = new RoomManager(broadcast);

  wss.on('connection', (ws, req) => {
    const { query: q } = url.parse(req.url, true);
    let user = null;

    try {
      const decoded = jwt.verify(q.token, process.env.JWT_SECRET);
      user = decoded;
    } catch (e) {
      ws.close(4001, 'Invalid or missing auth token');
      return;
    }

    let currentRoomCode = null;
    const socketEntry = { ws, userId: user.sub, userId5d: user.user_id_5d, username: null, lastChatAt: 0 };

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (e) {
        return ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid JSON' } }));
      }

      // KING LUDO events (ludo_*) are handled by their own module; Bingo events below are untouched
      if (await ludo.handleSocketMessage(ws, user, msg)) return;
      // KING DAMA events (dama_*) are handled by their own module
      if (await dama.handleSocketMessage(ws, user, msg)) return;

      try {
        switch (msg.type) {
          case 'join_room': {
            const { roomCode } = msg.payload;
            const roomRes = await query('SELECT * FROM game_rooms WHERE room_code = $1', [roomCode]);
            if (roomRes.rowCount === 0) {
              return ws.send(JSON.stringify({ type: 'error', payload: { message: 'Room not found' } }));
            }
            currentRoomCode = roomCode;
            addSocketToRoom(roomCode, socketEntry);

            if (!socketEntry.username) {
              const u = await query('SELECT username FROM users WHERE id = $1', [user.sub]);
              socketEntry.username = u.rows[0]?.username || `player${user.user_id_5d}`;
            }
            ws.send(JSON.stringify({ type: 'chat_history', payload: { messages: chatHistory.get(roomCode) || [] } }));

            const room = roomRes.rows[0];
            ws.send(JSON.stringify({ type: 'room_state', payload: room }));

            const playersRes = await query(
              `SELECT u.user_id_5d, u.username FROM game_entries ge
               JOIN users u ON u.id = ge.user_id WHERE ge.game_room_id = $1`,
              [room.id]
            );
            broadcast(roomCode, 'player_list', {
              players: playersRes.rows.map((r) => ({ user_id_5d: r.user_id_5d, username: maskUsername(r.username) })),
            });

            if (room.status === 'COUNTDOWN') {
              roomManager.scheduleGameStart(roomCode, room.id);
            }
            break;
          }

          case 'mark_number': {
            // client-side marking is cosmetic/local; authoritative check happens on claim_bingo
            const num = Number(msg.payload && msg.payload.number);
            if (!currentRoomCode || !Number.isInteger(num) || num < 1 || num > 75) break;
            broadcast(currentRoomCode, 'player_marked', { userId5d: user.user_id_5d, number: num });
            break;
          }

          case 'claim_bingo': {
            if (!currentRoomCode || !Array.isArray(msg.payload && msg.payload.markedNumbers)) {
              return ws.send(JSON.stringify({ type: 'claim_result', payload: { valid: false, reason: 'Invalid claim' } }));
            }
            const roomRes = await query('SELECT * FROM game_rooms WHERE room_code = $1', [currentRoomCode]);
            const room = roomRes.rows[0];
            const result = await roomManager.claimBingo(room.id, currentRoomCode, user.sub, msg.payload.markedNumbers);
            ws.send(JSON.stringify({ type: 'claim_result', payload: result }));
            break;
          }

          case 'chat_message': {
            if (!currentRoomCode) break;
            const text = cleanChatText(msg.payload && msg.payload.text);
            if (!text) break;
            const now = Date.now();
            if (now - socketEntry.lastChatAt < CHAT_COOLDOWN_MS) {
              return ws.send(JSON.stringify({ type: 'chat_error', payload: { message: 'ትንሽ ቆይተው ይላኩ።' } }));
            }
            socketEntry.lastChatAt = now;

            const entry = {
              id: ++chatSeq,
              username: maskUsername(socketEntry.username),
              userId5d: socketEntry.userId5d,
              text,
            };
            const history = chatHistory.get(currentRoomCode) || [];
            history.push(entry);
            if (history.length > CHAT_HISTORY_SIZE) history.shift();
            chatHistory.set(currentRoomCode, history);
            broadcast(currentRoomCode, 'chat', entry);
            break;
          }

          case 'leave_room': {
            if (currentRoomCode) removeSocketFromRoom(currentRoomCode, socketEntry);
            currentRoomCode = null;
            break;
          }

          default:
            ws.send(JSON.stringify({ type: 'error', payload: { message: `Unknown event type: ${msg.type}` } }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: err.message } }));
      }
    });

    ws.on('close', () => {
      ludo.handleSocketClose(ws);
      dama.handleSocketClose(ws);
      if (currentRoomCode) removeSocketFromRoom(currentRoomCode, socketEntry);
    });
  });

  return { wss, roomManager, broadcast };
}

module.exports = { createWsServer };
