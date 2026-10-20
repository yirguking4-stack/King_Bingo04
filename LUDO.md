# KING LUDO — integration notes

King Ludo lives next to Bingo; Bingo code paths are untouched.

## New files
- `backend/src/ludo/ludoEngine.js` (+ `.test.js`) — pure rules engine (server-side dice, moves, captures, timers rules)
- `backend/src/ludo/ludoManager.js` — rooms, wallet (GAME_ENTRY / GAME_REFUND / PRIZE), 3-min wait, turn timers, realtime push, admin overview
- `backend/src/ludo/ludoRoutes.js` — `/api/ludo/*` (players) and `/api/admin/ludo/overview` (admins only)
- `backend/src/ludo/ludoSchema.js`, `database/ludo_schema.sql` — 4 NEW tables: `ludo_rooms`, `ludo_players`, `ludo_turns`, `ludo_events`. Created automatically at server start (idempotent). No existing table is changed.
- `backend/src/ludo/ludoNotify.js` — Telegram messages for prize / refund
- `miniapp/src/ludo/*` — lobby, room, SVG board, dark-grey theme (`ludo.css`)
- `admin-panel/src/pages/LudoRooms.jsx` — "King Ludo" admin page

## Small edits to existing files
- `backend/src/server.js` — mounts the two Ludo routers, starts Ludo init (3 lines)
- `backend/src/websocket/wsServer.js` — forwards `ludo_*` messages to the Ludo module; close hook (2 lines)
- `miniapp/src/App.jsx`, `pages/Games.jsx`, `pages/Home.jsx` — "coming soon" cards become real buttons; `tab === 'ludo'`
- `miniapp/src/services/api.js`, `admin-panel/src/services/api.js` — API helpers

## Environment variables
None new. Uses the existing `DATABASE_URL`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `CORS_ORIGINS`, `MINI_APP_URL`.

## Rules implemented (your answers)
- Bets: Free,20,30,50,100,200,300,500,700,1000,2000,3000,4000,5000,7000,10000. 2 or 4 players. Crowns 1/2/4 = tokens needed to win; each player has 4 tokens.
- Prize = all stakes − 10% of each stake (e.g. 2×100 → 180). Free games move no money.
- Waiting: 3 min owned by the server. 4-player rooms restart the 3 min on every new player. If time runs out, every stake is refunded and the room closes (players go back to the lobby).
- Roll 20 s (auto-roll), move 15 s (auto-move, not counted as a miss). 2 consecutive missed rolls → player removed; a manual roll resets the counter. Same in 2- and 4-player games.
- Disconnect: game keeps running on the timers; no special penalty beyond the two-missed-rolls rule.
- A player may be in several games at once as long as the balance covers each stake.

## Auto-move policy (15 s timeout)
1) move that reaches the centre 2) capture 3) leave the yard 4) token furthest along (ties: lowest token number).

## Tests
- `node backend/src/ludo/ludoEngine.test.js` — 14 rules/timer tests
- Not run against a real PostgreSQL yet: do one real paid game with 2 test accounts after deploying (see report).

## Deploy
Render: redeploy backend (tables are created on boot). Vercel: redeploy miniapp and admin-panel. Keep ONE backend instance (timers and sockets are in-process; game state itself is stored in the DB and restored after a restart).

## Update 2 — design & icons
- Game room redrawn to the supplied design (navy/teal background, cyan board frame, pawn tokens, colour-ringed player pills with bet badge, game-id bar with crowns + prize).
- Brand icons in `miniapp/public/icons/` (`ludo.png`, `bingo.png`, `wallet.png`) used for the game cards, the wallet tab/menu/balance chips and the Ludo screens (`components/GameIcon.jsx`).
- Bingo tables: the button now always says **Join**; the balance is checked only when the player taps **Join Game** after choosing a card (message "Low Balance").

## Update 3
- **Six guarantee (engine):** while a player has no token out of the yard — at game start: the 3rd roll is a 6 if the first two weren't; after one of his tokens was captured (all back in the yard): the 7th roll is a 6 if the 6 before weren't. Constants `SIX_GUARANTEE_FIRST` (2) and `SIX_GUARANTEE_LATER` (6) at the top of `ludoEngine.js`. Applies to manual and automatic rolls.
- **Bot menu picture:** admin panel → Settings → "Telegram menu picture". Stored in table `menu_banner` (created automatically); the bot checks it every time it sends the menu. "Use original" returns to `bot/assets/menu-banner.jpg`. Needs the BOT service redeployed too.
- **Dice:** tumbling dice + "ትርርርር" click-rattle that slows down and ends with two knocks. **Win:** 😎, confetti cannons, classical fanfare (winner only).

## Update 4 — in-game reactions
- A captured token: 😭 pops up inside that player's own yard (box), visible to everybody.
- A token reaching home (centre): 😎 in the owner's yard + confetti burst from the middle of the board + fanfare. The last token / game over keeps the full winner screen instead.

## Update 5 — Telebirr / CBE choice and Agents
**Players (miniapp):** Deposit and Withdraw first show two picture buttons (Telebirr Fast / CBE Bank). Only the chosen method's form appears:
Telebirr → account(s) to pay + phone box (hint 09XXXXXXXX); CBE → account(s) to pay + account box (hint 1000*********). With several accounts the player picks which one he paid to.

**Agents (admin panel → Settings → "Agents"):** the admin gives a registered player (Player ID) the agent permission, sets the agent's Telebirr / CBE account and receives a one-time access code. An agent:
- logs in to the admin panel on the **Agent** tab (Player ID + code) and sees ONLY the Transactions page;
- gets the Telegram alerts: a deposit sent to HIS account, and all withdrawals (admins get everything);
- can approve/reject only those requests, never his own, never anything else (server-enforced, `routes/agentRoutes.js`).
New tables (created automatically): `agents`, `deposit_routing`. New env vars: none. Redeploy: backend (Render), miniapp and admin-panel (Vercel). The bot service does not change.
