# KING BINGO (Bingo + Ludo + Dama) — ደረጃ በደረጃ የመጫን መመሪያ

ቅደም ተከተል፦ **1) Termux → 2) GitHub → 3) Neon (ዳታቤዝ) → 4) Render (backend + bot) → 5) Cloudflare Pages (mini app + admin) → 6) ማገናኘት → 7) ሙከራ**

> ⚠️ ሚስጥሮችን (bot token, DATABASE_URL, JWT_SECRET) በፍጹም GitHub ላይ አይጫኑ። `.env` ፋይሎች በ `.gitignore` ተዘግተዋል። ሚስጥሩን ከለጠፉት ወዲያውኑ ይቀይሩት (BotFather → /revoke)።

---------------------------------------------------------------------

## 0. የሚያስፈልጉ መለያዎች (ነጻ)
GitHub · Neon (neon.tech) · Render (render.com) · Cloudflare · Telegram + @BotFather

## 1. Termux ማዘጋጀት

```bash
pkg update -y && pkg upgrade -y
pkg install -y git unzip nodejs-lts
termux-setup-storage          # ፍቃድ ስጡ (ፋይሎችን ለማንበብ)
git config --global user.name  "የእርስዎ ስም"
git config --global user.email "you@example.com"
```

ዚፕ ፋይሉን (`King_Bingo_Final.zip`) ወደ ስልክዎ Download አውርደው ፦

```bash
cd ~
unzip ~/storage/downloads/King_Bingo_Final.zip
cd King_Bingo--main            # የአቃፊው ስም ከዚፑ ውስጥ ያለው ነው (ls ብለው ያረጋግጡ)
ls                             # admin-panel backend bot database docs miniapp ... ይታያል
```

(አማራጭ) ኮዱን በ Termux ውስጥ ይፈትሹ፦

```bash
cd backend && npm install && npm test && cd ..
```
ሁሉም `ok -` ካሳዩ ጥሩ ነው (ludo + dama engine + money)።

## 2. ወደ GitHub መጫን (አዲስ repository)

### 2.1 GitHub ላይ repository ይፍጠሩ
github.com → **New repository** → ስም፦ `king-bingo` → **Private** (ይመከራል) → **README/.gitignore አይጨምሩ** (ባዶ ይሁን) → Create.

### 2.2 Personal Access Token (ለ Termux ይለፍ ቃል)
GitHub → Settings → Developer settings → **Personal access tokens → Tokens (classic) → Generate new token** → ስም `termux` → scope ✅ **repo** → Generate → ቶክኑን ይቅዱ (አንድ ጊዜ ብቻ ይታያል)።

### 2.3 Push

```bash
cd ~/King_Bingo--main
git init -b main
git add .
git status | head -30          # .env ፋይል እንዳልተጨመረ ያረጋግጡ!
git commit -m "King Bingo: Bingo + Ludo + Dama"
git remote add origin https://github.com/<USERNAME>/king-bingo.git
git push -u origin main
```
Username ሲጠይቅ GitHub username፤ Password ሲጠይቅ **ቶክኑን** ያስገቡ።

ወደፊት ለውጥ ሲያደርጉ፦ `git add . && git commit -m "ለውጥ" && git push`  (Render እና Cloudflare በራሳቸው ይታደሳሉ)

## 3. ዳታቤዝ — Neon

1. neon.tech → Sign up → **Create project** (ስም `kingbingo`፣ Region ለ Render ቅርብ የሆነ፤ Postgres 16).
2. Dashboard → **Connect** → **Connection string** ይቅዱ። ይህ ይመስላል፦
   `postgresql://user:pass@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`
   ይህ ለ Render ላይ `DATABASE_URL` ይሆናል።
3. Neon → **SQL Editor** → የ repo ውስጥ `database/schema.sql` ይዘቱን ሙሉ ገልብጠው ለጥፈው **Run** ይጫኑ (አንድ ጊዜ ብቻ)።
   (Termux ላይ ፋይሉን ለማየት፦ `cat ~/King_Bingo--main/database/schema.sql` ከዚያ ይምረጡና ይቅዱ።)
4. Ludo እና **Dama ሰንጠረዦች** (`ludo_*`, `dama_*`) backend ሲጀምር **በራሳቸው ይፈጠራሉ** — ምንም ማድረግ አያስፈልግም።

## 4. Backend — Render

### 4.1 Backend Web Service
Render → **New + → Web Service** → GitHub repo `king-bingo` ይምረጡ።

| መስክ | ዋጋ |
|---|---|
| Name | `king-bingo-backend` |
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Instances | **1 ብቻ** (timers እና sockets በ process ውስጥ ናቸው) |

**Environment variables** (Environment ትር):

```
NODE_ENV=production
DATABASE_URL=<ከ Neon የተቀዳው>
TELEGRAM_BOT_TOKEN=<ከ BotFather>
JWT_SECRET=<ረጅም ዘፈቀደ ሕብረቁምፊ>
BOT_INTERNAL_SECRET=<ሌላ ረጅም ዘፈቀደ>
ADMIN_TELEGRAM_IDS=<የእርስዎ Telegram ID>
ADMIN_BOOTSTRAP_CODE=<ረጅም ዘፈቀደ ኮድ — ለ admin panel መግቢያ>
ALLOW_ADMIN_BOOTSTRAP=false
CORS_ORIGINS=            (ለጊዜው ባዶ — ደረጃ 6 ላይ ይሞላል)
ADMIN_PANEL_URL=         (ደረጃ 6 ላይ ይሞላል)
```
ዘፈቀደ ሕብረቁምፊ ለመስራት Termux ላይ፦ `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Deploy → Logs ውስጥ ይህን ማየት አለብዎት፦ `[king-bingo] backend listening…`, `[ludo] ready…`, `[dama] ready…`
ሙከራ፦ `https://king-bingo-backend.onrender.com/health` → `{"status":"ok"}`

> ⚠️ **Render Free plan** ከ15 ደቂቃ በኋላ ይተኛል — ያኔ የጨዋታ ቆጣሪዎች እና WebSockets ይቆማሉ። ለእውነተኛ ተጫዋቾች **Starter (paid)** ይጠቀሙ። (King Dama ከተኛ በኋላ ሲነሳ ያለፈ ተራ ጊዜን እንደ ሲስተም ችግር ቆጥሮ አዲስ ሙሉ ጊዜ ይሰጣል።)

### 4.2 Bot Service
Render → **New + → Web Service** (ተመሳሳይ repo):

| መስክ | ዋጋ |
|---|---|
| Name | `king-bingo-bot` |
| Root Directory | `bot` |
| Build / Start | `npm install` / `npm start` |

Env፦
```
TELEGRAM_BOT_TOKEN=<ተመሳሳይ token>
BACKEND_API_URL=https://king-bingo-backend.onrender.com
BOT_INTERNAL_SECRET=<ከ backend ጋር ተመሳሳይ>
MINI_APP_URL=<ደረጃ 5 ላይ ከ Cloudflare የሚያገኙት — ለጊዜው https://example.com>
SUPPORT_USERNAME=<የ admin username ያለ @>
BOT_USERNAME=<የ bot username ያለ @>
```
(ቦቱ በ polling ይሰራል፤ ተመሳሳይ token ያለው ሁለተኛ bot instance አያሂዱ — 409 ስህተት ይመጣል።)

## 5. Cloudflare Pages — Mini App እና Admin Panel

Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git** → repo `king-bingo`።

### 5.1 Mini App (ፕሮጀክት #1)
| መስክ | ዋጋ |
|---|---|
| Project name | `king-bingo-app` |
| Production branch | `main` |
| Framework preset | None (ወይም Vite) |
| **Root directory** | `miniapp` |
| Build command | `npm install && npm run build` |
| Build output directory | `dist` |

Environment variables (Settings → Variables → **Production**)፦
```
NODE_VERSION=20
VITE_BACKEND_URL=https://king-bingo-backend.onrender.com
VITE_SUPPORT_USERNAME=<admin username>
VITE_BOT_USERNAME=<bot username>
```
Save and Deploy → URL ያገኛሉ፦ `https://king-bingo-app.pages.dev`

> `VITE_*` ተለዋዋጮች **በ build ጊዜ** ይገባሉ — ከቀየሩ እንደገና Deploy (Retry deployment) ያድርጉ። `https://` መሆኑን እና መጨረሻ ላይ `/` አለመኖሩን ያረጋግጡ (ws:// ወደ wss:// በራሱ ይቀየራል)።

### 5.2 Admin Panel (ፕሮጀክት #2)
**Create → Pages → Connect to Git** (ተመሳሳይ repo ድጋሚ)፦
| መስክ | ዋጋ |
|---|---|
| Project name | `king-bingo-admin` |
| **Root directory** | `admin-panel` |
| Build command | `npm install && npm run build` |
| Build output directory | `dist` |

Env፦
```
NODE_VERSION=20
VITE_BACKEND_URL=https://king-bingo-backend.onrender.com
VITE_BOT_USERNAME=<bot username>
```
URL፦ `https://king-bingo-admin.pages.dev`

## 6. ሁሉንም ማገናኘት

1. **Render backend → Environment** ያዘምኑ፦
   ```
   CORS_ORIGINS=https://king-bingo-app.pages.dev,https://king-bingo-admin.pages.dev
   ADMIN_PANEL_URL=https://king-bingo-admin.pages.dev
   ```
   (መጨረሻ ላይ `/` የለም፣ ኮማ ብቻ ነው የሚለየው) → Save → ራሱ እንደገና ይነሳል።
2. **Render bot → Environment**፦ `MINI_APP_URL=https://king-bingo-app.pages.dev` → Save.
3. **BotFather** (Telegram):
   - `/mybots` → bot → **Bot Settings → Menu Button** → URL = `https://king-bingo-app.pages.dev`
   - (አማራጭ) `/newapp` ለ Mini App short name።
   - **Admin Panel Telegram Login** ለመስራት፦ `/setdomain` → bot ይምረጡ → `king-bingo-admin.pages.dev` (ያለ https://)።
4. **የመጀመሪያው Admin**፦ ቦቱ ላይ `/start` ብለው ይመዝገቡ፣ ከዚያ Neon SQL Editor ላይ፦
   ```sql
   UPDATE users SET is_admin = TRUE WHERE user_id_5d = '00001';
   ```
   (Player ID ከ Mini App Profile ይታያል።) Admin panel መግቢያ = Player ID + `ADMIN_BOOTSTRAP_CODE`።

## 7. King Dama ሙከራ (ከመልቀቅዎ በፊት — በጣም አስፈላጊ)

ይህ ኮድ ከእውነተኛ PostgreSQL ጋር እስካሁን አልተፈተነም፤ ስለዚህ በ **2 የሙከራ account** (ሁለት የተለያዩ Telegram) ይሞክሩ፦

1. Admin Panel → Players → ለሁለቱም ቀሪ ሂሳብ ይስጡ (ለምሳሌ 500 ETB)።
2. Mini App → Games → **KING DAMA** → 50 ETB ይምረጡ → "ተጋጣሚ ፈልግ" → የ 120 ሰከንድ ቆጣሪ ይታያል።
3. **ፍለጋ ሰርዝ** → ቀሪ ሂሳብ 50 ተመልሷል (Transactions ውስጥ GAME_REFUND) ✔
4. እንደገና ፈልገው ሁለተኛው account ተመሳሳይ 50 ይፈልግ → ጨዋታ በራሱ ይጀምራል ✔
5. ተራ ይጫወቱ፤ መብላት ሲኖር ሌላ እርምጃ እንደማይፈቀድ ያረጋግጡ ✔
6. አንዱ **resign** ያድርግ → አሸናፊው **90** ይቀበላል፤ Admin → King Dama → commission **10** ✔
7. ሌላ ጨዋታ ጀምረው 45 ሰከንድ ተራ ሳይጫወቱ ይቆዩ → timeout → ተቃራኒው ያሸንፋል ✔
8. Admin → King Dama → ቆጣሪ (15/30/45/60) እና stakes ይቀይሩ → Save ✔

## 8. የተለመዱ ችግሮች

| ምልክት | ምክንያት / መፍትሄ |
|---|---|
| Mini App "ግንኙነት አልተሳካም" | `VITE_BACKEND_URL` ስህተት ወይም `CORS_ORIGINS` ላይ የ Cloudflare URL የለም። ከቀየሩ Cloudflare ላይ Retry deployment |
| ጨዋታ "Live" አይልም / ሁሌ እንደገና ይገናኛል | Render service ተኝቷል (Free plan) ወይም backend URL `http://` ነው — `https://` ይጠቀሙ |
| `password authentication failed` / SSL error | `DATABASE_URL` መጨረሻ `?sslmode=require` መያዙን ያረጋግጡ |
| Bot አይመልስም / 409 Conflict | ሁለት bot instance በተመሳሳይ token እየሰሩ ነው — አንዱን ያጥፉ |
| Admin login አይሰራም | BotFather `/setdomain` አልተደረገም፣ ወይም `is_admin` አልተሰጠም |
| ማንኛውም `dama_*` ሰንጠረዥ የለም ስህተት | backend logs ይመልከቱ (`[dama] init failed`)፤ `DATABASE_URL` ይፈትሹ — ሰንጠረዦች በ boot ጊዜ ይፈጠራሉ |
| Cloudflare build ይወድቃል | `NODE_VERSION=20` እና Root directory (`miniapp` / `admin-panel`) ያረጋግጡ |
| Termux `git push` ይከለክላል | Password ቦታ ላይ GitHub **token** ይጠቀሙ (የ GitHub password አይደለም) |

## 9. ከመልቀቅዎ በፊት ማረጋገጫ
- [ ] `.env` ፋይሎች ወደ GitHub አልተጫኑም (`git ls-files | grep .env` → `.env.example` ብቻ)
- [ ] `ALLOW_ADMIN_BOOTSTRAP=false`
- [ ] Render ላይ 1 instance ብቻ
- [ ] የ Neon ዳታቤዝ backup (Neon → Branches/Backups) ተዘጋጅቷል
- [ ] ሁሉንም የ §7 ሙከራዎች አልፈዋል
- [ ] ይህ ሲስተም **virtual credits** ይጠቀማል። እውነተኛ ገንዘብ ከማስተናገድዎ በፊት የኢትዮጵያ ህግ፣ ፈቃድ፣ የክፍያ አቅራቢ እና የ Telegram ፖሊሲ መረጋገጥ አለበት።
