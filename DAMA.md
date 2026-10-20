# KING DAMA (Russian Checkers) — integration notes

King Dama is the third game of King Bingo (Bingo + Ludo + Dama). Bingo and Ludo code paths are untouched.

## New files
- `backend/src/dama/damaEngine.js` (+ `.test.js`) — pure Russian-checkers rules engine (25 tests)
- `backend/src/dama/damaMoney.js` (+ `.test.js`) — integer ETB pot / 10% commission / winner payout (7-row table tested)
- `backend/src/dama/damaManager.js` — matchmaking, wallet (GAME_ENTRY / GAME_REFUND / PRIZE), timers, settlement, realtime push
- `backend/src/dama/damaRoutes.js` — `/api/dama/*` (players) and `/api/admin/dama/*` (admins only)
- `backend/src/dama/damaSchema.js`, `database/dama_schema.sql` — 4 NEW tables (`dama_rooms`, `dama_players`, `dama_moves`, `dama_events`), created automatically at server start
- `miniapp/src/dama/DamaApp.jsx`, `dama.css` — stake selection, matchmaking timer, board, result, history
- `admin-panel/src/pages/DamaRooms.jsx` — live matches, results, config, void & refund

## Small edits to existing files
`server.js` (mount routes + init), `wsServer.js` (forward `dama_*` messages), `miniapp/src/App.jsx`, `pages/Games.jsx`, `services/api.js`, `services/launch.js`, `bot/bot.js` ("King Dama ♛" menu button), `admin-panel/src/App.jsx`, `services/api.js`, `backend/package.json` (`npm test`).

## Rules
- Russian draughts: 8x8, 12 pieces each, white moves first. Men move forward 1, capture forward AND backward. Flying kings.
- **Capture is mandatory** (any piece); **sequence must be finished with the same piece**; free choice of sequence (no majority rule) unless the admin turns on the *Majority-capture variant*.
- Captured pieces are removed at the end of the sequence and cannot be jumped twice (Turkish strike).
- A man reaching the last row **during a capture** becomes a king and keeps capturing as a king. Promotion by a plain move ends the turn.
- Results: all pieces captured, no legal move, timeout, resign, draw (threefold repetition, or 15 moves each with kings only and no capture).
- NOT implemented: the "3 kings vs 1 king on the main diagonal" draw rule, draw offers.

## Money (whole ETB integers)
| Stake | Pot | 10% commission | Winner |
|---|---|---|---|
| 50 | 100 | 10 | 90 |
| 70 | 140 | 14 | 126 |
| 100 | 200 | 20 | 180 |
| 200 | 400 | 40 | 360 |
| 500 | 1,000 | 100 | 900 |
| 1,000 | 2,000 | 200 | 1,800 |
| 5,000 | 10,000 | 1,000 | 9,000 |

- Stake is taken (GAME_ENTRY) the moment a player enters the search = reservation. Commission is only taken when a decisive game is settled; it is recorded in `dama_rooms.commission_taken`.
- **Refund policy (no commission in all of these):** search cancelled, search expired (default 120 s), draw (both stakes back), match voided by an admin after a verified platform failure.
- Settlement happens inside the room-row lock and is guarded by `dama_rooms.settled` -> no duplicate payout / commission.
- Matchmaking is serialised per stake with a Postgres advisory lock; a player cannot have two searches/games at once (wallet-row lock + check).

## Timers (server authoritative)
- Turn timer default 45 s (admin: 15/30/45/60). Deadline stored in `dama_rooms.state.deadline` (survives restarts). Not reset by selecting pieces, refreshing or repeated requests; mid-capture-chain steps keep the same deadline. Reset only when the turn changes.
- Race rule: inside the room lock the server compares its own clock with the persisted deadline. `now >= deadline` -> move rejected (STALE) and the timeout is processed; otherwise the move wins. Only one outcome can be committed.
- Matchmaking timer (default 120 s, admin 15–900) is separate from the turn timer.
- **Restart/outage policy:** after a server restart, a turn deadline that already expired while the server was down gets a fresh full timer (logged `OUTAGE_GRACE`) instead of a timeout loss. Admin can also *Void & refund* a match.
- Disconnects: no penalty, the timer keeps running (same as Ludo).

## Admin settings (stored in `admin_settings`)
`dama_bets`, `dama_turn_seconds`, `dama_wait_seconds`, `dama_majority`, `dama_enabled` — change them in Admin Panel -> King Dama. Each change is written to `audit_logs`.

## Tests
```
cd backend && npm test      # ludo engine + dama engine (25) + dama money
```
A 3000-game random self-play fuzz run of the engine finished with no exceptions or rule violations.
**Not yet run against a real PostgreSQL / Telegram**: after deploying, play one paid game with 2 test accounts (match, move, timeout, cancel-search, draw/resign) and check the Transactions tab.

## Money mode
This project's wallet is the existing virtual-credit ledger (admin-reviewed deposits/withdrawals). King Dama uses it as-is; no real payment provider is connected. Do not market the credits as real money until you have verified the legal/licensing/payment/Telegram-policy requirements.
