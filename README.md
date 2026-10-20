# KING BINGO — Real Platform + Virtual Economy

A production-shaped Telegram Mini App real-time game platform with **3 games: Bingo, King Ludo, King Dama (Russian Checkers)**.
See `LUDO.md`, `DAMA.md` and the step-by-step deployment guide `docs/DEPLOY_AM.md` (Termux -> GitHub -> Neon -> Render -> Cloudflare).

**Real:** Telegram bot, Telegram Mini App, backend, PostgreSQL database, WebSocket game
engine, Bingo rooms, admin panel, admin approval/rejection workflow, transaction ledger,
audit logs.

**Virtual:** the in-app economy. All wallet balances are "Virtual Credits" with no
real-world monetary value. Deposit/withdrawal are admin-reviewed *requests* that move
virtual credits in or out of a player's wallet — the platform never automates, tracks,
or processes a real-money transfer. The admin's Telebirr account is shown to players as
copy/reference information only.

---

## Project layout

```
king-bingo/
├── database/
│   └── schema.sql          # Full Postgres schema (users, wallets, transactions, games, audit)
├── backend/                # Express + ws API and real-time game server
│   └── src/
│       ├── config/db.js
│       ├── models/         # userModel, walletModel
│       ├── game/           # bingoEngine, amharicCaller, roomManager
│       ├── websocket/      # wsServer
│       ├── routes/         # auth, users, wallet, games, admin, bot (internal)
│       └── middleware/     # auth.js (JWT + admin guard)
├── bot/                    # Telegram bot (node-telegram-bot-api), real onboarding
├── miniapp/                # React + @twa-dev/sdk Mini App (players)
└── admin-panel/            # React admin console (Telegram Login Widget auth)
```

---

## 1. Database

```bash
createdb kingbingo
psql -d kingbingo -f database/schema.sql
```

Or use the backend's migration helper once `DATABASE_URL` is set:

```bash
cd backend
npm install
npm run migrate
```

If you use Neon, run `database/schema.sql` once in the Neon SQL Editor. If the tables already exist and only
the Player ID counter is missing, run just this:

```sql
CREATE SEQUENCE IF NOT EXISTS user_id_5d_seq START 1 MAXVALUE 99999;
SELECT setval('user_id_5d_seq', COALESCE((SELECT MAX(user_id_5d::int) FROM users), 0) + 1, false);
```

### Becoming the first admin

Register normally through the bot first, then use ONE of these:

**A) SQL (simplest):** `UPDATE users SET is_admin = TRUE WHERE user_id_5d = '00001';`

**B) From the Mini App (Profile -> Admin Access):** set `ALLOW_ADMIN_BOOTSTRAP=true`, put your Telegram ID in
`ADMIN_TELEGRAM_IDS` and set a long `ADMIN_BOOTSTRAP_CODE`. After you became admin set
`ALLOW_ADMIN_BOOTSTRAP=false` again.

Admin panel login = your Player ID + `ADMIN_BOOTSTRAP_CODE`.

## 2. Backend

```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL, TELEGRAM_BOT_TOKEN, JWT_SECRET, BOT_INTERNAL_SECRET
npm install
npm run dev            # or: npm start
```

Runs the REST API and the `/ws` WebSocket endpoint on the same HTTP server (default port 4000).

## 3. Telegram bot

```bash
cd bot
cp .env.example .env   # TELEGRAM_BOT_TOKEN, MINI_APP_URL, BACKEND_API_URL, BOT_INTERNAL_SECRET (must match backend)
npm install
npm start
```

Set your bot's Mini App URL and menu button via @BotFather to point at where you host `miniapp/`.

## 4. Mini App (players)

```bash
cd miniapp
cp .env.example .env   # VITE_BACKEND_URL
npm install
npm run dev             # local dev
npm run build            # production build -> serve behind HTTPS, register that URL with @BotFather
```

The Mini App only ever talks to your backend and Telegram's own SDK — no external links or
browser redirects anywhere in the flow, per the platform requirement.

## 5. Admin panel

```bash
cd admin-panel
cp .env.example .env   # VITE_BACKEND_URL, VITE_BOT_USERNAME (for the Telegram Login Widget)
npm install
npm run dev
```

Admins log in with Telegram's official Login Widget. The backend only issues an admin
session token if that Telegram account already exists in `users` with `is_admin = TRUE`.

---

## Key design notes

- **Two different Telegram auth schemes, on purpose.** The Mini App verifies
  `initData` (HMAC using `HMAC-SHA256("WebAppData", bot_token)` as the key — see
  `backend/src/utils/telegramAuth.js`). The Admin Panel is a normal browser page with no
  access to Mini App context, so it uses Telegram's official Login Widget instead, which
  has a different, documented verification scheme (`backend/src/utils/telegramLoginWidget.js`).
- **The bot's registration calls are a third trust boundary.** They're server-to-server
  (bot → backend), authenticated with a shared secret header, not `initData` — the bot
  process already trusts Telegram's Bot API delivery.
- **Money flow is intentionally virtual end-to-end.** `walletModel.js` and
  `adminRoutes.js` implement deposit/withdrawal as PENDING → admin APPROVE/REJECT
  transactions against a virtual credit ledger. There is no code path that reaches a
  real payment processor, and the Telebirr account is served purely as display text
  (`GET /api/wallet/telebirr-info`) for the player to copy.
- **Nothing trusts the client.** Wallet balance, card contents, and win checking all
  live server-side; `roomManager.claimBingo` re-validates a claimed win against the
  room's actual `called_numbers` and the player's stored card before paying out.
- **Amharic caller** (`backend/src/game/amharicCaller.js`) maps all 75 standard Bingo
  numbers to spoken Amharic while keeping the B-I-N-G-O letters in English, as specified.

## What you still need to do before going live

1. Get a real bot token from @BotFather and a domain with HTTPS for both the Mini App
   and Admin Panel (Telegram requires HTTPS for Mini Apps and the Login Widget).
2. Point @BotFather's Mini App / menu button configuration at your deployed `miniapp` URL.
3. Set `ADMIN_TELEGRAM_IDS`/`is_admin` for your real admin accounts.
4. Review the stake tiers and commission percentages in `stake_tiers` for your market.
5. Decide your own policy for how players actually acquire virtual credits (e.g. a
   promotional grant flow, a real licensed payment integration kept fully separate from
   this ledger, etc.) — this scaffold intentionally stops at the virtual-ledger boundary.
