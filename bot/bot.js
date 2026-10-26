require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL;
const BACKEND_API_URL = process.env.BACKEND_API_URL;
const BOT_SECRET = process.env.BOT_INTERNAL_SECRET;
// Admin's Telegram username (without @) that players contact for help
// Accepts "name", "@name" or "https://t.me/name"; anything invalid is ignored (so a typo can never break /start).
const SUPPORT_USERNAME = (() => {
  const raw = (process.env.SUPPORT_USERNAME || '')
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^@/, '');
  if (!raw) return '';
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(raw)) {
    console.error(`[bot] SUPPORT_USERNAME "${raw}" is not a valid Telegram username - Support button disabled`);
    return '';
  }
  return raw;
})();

// How the blue "Menu" button next to the message box behaves:
//   commands (default) -> shows the command list; tapping /menu sends the picture menu below
//   webapp             -> leave whatever is set in BotFather (e.g. opens the Mini App directly)
const MENU_BUTTON_MODE = (process.env.MENU_BUTTON_MODE || 'commands').toLowerCase();
let BOT_USERNAME = (process.env.BOT_USERNAME || '').replace(/^@/, '');

function supportRow() {
  return SUPPORT_USERNAME ? [{ text: '💬 እርዳታ / Support', url: `https://t.me/${SUPPORT_USERNAME}` }] : null;
}

function tgLink(raw) {
  let v = String(raw || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^t\.me\//i.test(v)) return 'https://' + v;
  v = v.replace(/^@/, '');
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(v) ? `https://t.me/${v}` : '';
}
const CHANNEL_LINK = tgLink(process.env.CHANNEL_URL);
const GROUP_LINK = tgLink(process.env.GROUP_URL);

async function handleJoinCallback(q) {
  if (q.data !== 'join') return false;
  await bot.answerCallbackQuery(q.id).catch(() => {});
  if (!q.message) return true;
  const rows = [];
  const lines = [];
  if (CHANNEL_LINK) { rows.push([{ text: '📢 Channel ይቀላቀሉ', url: CHANNEL_LINK }]); lines.push(`📢 Channel: ${CHANNEL_LINK}`); }
  if (GROUP_LINK) { rows.push([{ text: '👥 Group ይቀላቀሉ', url: GROUP_LINK }]); lines.push(`👥 Group: ${GROUP_LINK}`); }
  const text = rows.length ? `KING BINGO Channel እና Group ይቀላቀሉ 👇\n\n${lines.join('\n')}` : 'የ Channel እና Group ሊንኮች ገና አልተዘጋጁም። እባክዎ ቆይተው ይሞክሩ።';
  await bot.sendMessage(q.message.chat.id, text, { reply_markup: rows.length ? { inline_keyboard: rows } : undefined, disable_web_page_preview: true });
  return true;
}

if (!TOKEN) {
  console.error('[bot] TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

// Prevent the whole process from crashing on network hiccups or unexpected
// rejections (Render was killing the service on "Exited with status 1").
process.on('unhandledRejection', (reason) => {
  console.error('[bot] Unhandled rejection:', reason && reason.message ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[bot] Uncaught exception:', err && err.message ? err.message : err);
});

// Start with polling OFF, clear any leftover webhook, then start polling.
// A webhook left over from earlier testing causes a 409 conflict that can
// crash some versions of this library on startup.
const bot = new TelegramBot(TOKEN, { polling: false });

async function start() {
  try {
    await bot.deleteWebHook({ drop_pending_updates: true });
    console.log('[bot] cleared any existing webhook');
  } catch (err) {
    console.error('[bot] deleteWebHook failed (continuing anyway):', err.message);
  }
  try {
    await bot.setMyCommands([
      { command: 'menu', description: '👑 ዋና ማውጫ / Menu' },
      { command: 'start', description: 'KING BINGO ክፈት' },
      { command: 'support', description: 'እርዳታ / Contact Admin' },
    ]);
  } catch (err) {
    console.error('[bot] setMyCommands failed:', err.message);
  }
  try {
    if (!BOT_USERNAME) BOT_USERNAME = (await bot.getMe()).username || '';
  } catch (err) {
    console.error('[bot] getMe failed:', err.message);
  }
  await configureMenuButton();
  bot.startPolling();
  console.log('[king-bingo bot] polling started');
}

function api(apiPath, options = {}) {
  return fetch(`${BACKEND_API_URL}${apiPath}`, {
    timeout: 8000, // never wait forever on a sleeping/hung backend - the player must always get an answer
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-bot-secret': BOT_SECRET,
      ...(options.headers || {}),
    },
  });
}

async function configureMenuButton() {
  if (MENU_BUTTON_MODE !== 'commands') return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menu_button: { type: 'commands' } }),
      timeout: 10000,
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) console.error('[bot] setChatMenuButton failed:', data.description || res.status);
  } catch (err) {
    console.error('[bot] setChatMenuButton failed:', err.message);
  }
}

function appUrl(ref) {
  if (!ref || !MINI_APP_URL) return MINI_APP_URL;
  const sep = MINI_APP_URL.includes('?') ? '&' : '?';
  return `${MINI_APP_URL}${sep}ref=${ref}`;
}

if (!MINI_APP_URL || !/^https:\/\//i.test(MINI_APP_URL)) {
  console.error(`[bot] WARNING: MINI_APP_URL must be a public https:// URL (current: "${MINI_APP_URL}"). Telegram rejects web_app buttons otherwise.`);
}
if (!BACKEND_API_URL) console.error('[bot] WARNING: BACKEND_API_URL is not set');
if (!BOT_SECRET) console.error('[bot] WARNING: BOT_INTERNAL_SECRET is not set (must match the backend)');

/** Send with buttons; if Telegram rejects the buttons, still send the text so the player always gets a reply. */
async function safeSend(chatId, text, options) {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (err) {
    console.error('[bot] sendMessage with buttons failed:', err.message);
    return bot.sendMessage(chatId, text);
  }
}

// ---------------------------------------------------------------------------
// Picture menu: banner image + buttons (Play Games, Deposit, Withdraw, ...).
// It is sent by /menu and /start, pinned to the top of the chat and never removed by the bot,
// so a player does not have to open the Menu button every time.
// ---------------------------------------------------------------------------
const MENU_BANNER = path.join(__dirname, 'assets', 'menu-banner.jpg');
let bannerVersion = 0; // 0 = built-in picture, otherwise the admin's picture (updated_at in ms)
let bannerBuffer = null;
let menuPhotoFileId = null; // after the first upload Telegram lets us resend the picture by id
const lastMenuMessage = new Map(); // chatId -> message_id of the menu we sent last

/** Mini App link that opens straight on a page: appLink({ tab: 'wallet', mode: 'withdraw' }). */
function appLink(params = {}) {
  if (!MINI_APP_URL) return MINI_APP_URL;
  try {
    const u = new URL(MINI_APP_URL);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    return MINI_APP_URL;
  }
}

function buildMenuKeyboard(userId5d) {
  const open = (text, params) => ({ text, web_app: { url: appLink(params) } });
  const help = open('እርዳታ 📲', { tab: 'support' });
  const share = { text: 'Join Group/Channel 📢', callback_data: 'join' };
  return [
    [open('Play Games 🎮', { tab: 'games' })],
    [open('Deposit 💰', { tab: 'deposit' }), open('Withdraw 💰', { tab: 'withdraw' })],
    [open('My Profile 👤', { tab: 'profile' }), open('Transactions 📜', { tab: 'transactions' })],
    [help, share],
    [open('ቀጠሮ 🗓', { tab: 'appointments' })],
  ];
}

/** Ask the backend whether the admin changed the picture; if so download it and forget the cached file_id. */
async function refreshBanner() {
  try {
    const v = await api('/api/bot/menu-banner/version', { timeout: 3000 });
    if (!v.ok) return;
    const { version } = await v.json();
    if (version === bannerVersion) return;
    if (!version) {
      bannerVersion = 0;
      bannerBuffer = null;
    } else {
      const img = await api('/api/bot/menu-banner', { timeout: 10000 });
      if (!img.ok) return;
      bannerBuffer = await img.buffer();
      bannerVersion = version;
    }
    menuPhotoFileId = null; // different picture -> upload it again
    console.log('[bot] menu picture updated, version', bannerVersion);
  } catch (err) {
    console.error('[bot] banner check failed (keeping the current picture):', err.message);
  }
}

async function sendMenuPhoto(chatId, reply_markup) {
  await refreshBanner();
  if (menuPhotoFileId) {
    try {
      return await bot.sendPhoto(chatId, menuPhotoFileId, { reply_markup });
    } catch (err) {
      console.error('[bot] resend by file_id failed, uploading again:', err.message);
      menuPhotoFileId = null;
    }
  }
  const source = bannerBuffer || fs.createReadStream(MENU_BANNER);
  const sent = await bot.sendPhoto(chatId, source, { reply_markup }, { filename: 'menu-banner.jpg', contentType: bannerBuffer && bannerBuffer[0] === 0x89 ? 'image/png' : 'image/jpeg' });
  if (sent && sent.photo && sent.photo.length) menuPhotoFileId = sent.photo[sent.photo.length - 1].file_id;
  return sent;
}

async function pinMenu(chatId, messageId) {
  try {
    if (typeof bot.unpinAllChatMessages === 'function') await bot.unpinAllChatMessages(chatId).catch(() => {});
    await bot.pinChatMessage(chatId, messageId, { disable_notification: true });
  } catch (err) {
    console.error('[bot] could not pin the menu:', err.message);
  }
}

async function sendMenu(chatId, { userId5d } = {}) {
  const reply_markup = { inline_keyboard: buildMenuKeyboard(userId5d) };
  let sent;
  try {
    sent = await sendMenuPhoto(chatId, reply_markup);
  } catch (err) {
    console.error('[bot] menu picture failed, sending a text menu instead:', err.message);
    sent = await safeSend(chatId, '👑 KING BINGO — ዋና ማውጫ', { reply_markup });
  }
  // the newest menu replaces the previous copy (no duplicates in the chat) and is pinned
  const previous = lastMenuMessage.get(chatId);
  lastMenuMessage.set(chatId, sent.message_id);
  if (previous) bot.deleteMessage(chatId, previous).catch(() => {});
  pinMenu(chatId, sent.message_id); // not awaited: never delays the reply
  return sent;
}

// Telegram posts "bot pinned a message" into the chat; remove that noise
bot.on('pinned_message', (msg) => {
  bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
});

async function handleStart(msg, match) {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const username = msg.from.username;
  const param = match && match[1] ? match[1] : null;

  console.log(`[bot] /start from telegramId=${telegramId} username=${username || '(none)'}`);

  if (!username) {
    return bot.sendMessage(
      chatId,
      'Access Blocked: A Telegram @username is required to use this app. Please set a username in your Telegram profile settings and type /start again.\n\n' +
        'መግባት አይቻልም፦ ይህን መተግበሪያ ለመጠቀም የቴሌግራም @username ያስፈልጋል። እባክዎ በቴሌግራም ፕሮፋይል ቅንብር ውስጥ username ያስቀምጡና /start ብለው እንደገና ይላኩ።'
    );
  }

  const ref = param && /^[0-9]{5}$/.test(param) ? param : null;

  // true = registered, false = new user, null = could not find out (backend asleep / error)
  let registered = null;
  let registeredInfo = {};
  try {
    const check = await api(`/api/bot/user/${telegramId}`);
    if (check.status === 200) {
      registered = true;
      registeredInfo = await check.json().catch(() => ({}));
    }
    else if (check.status === 404) registered = false;
    else console.error('[bot] backend user check returned status', check.status);
  } catch (err) {
    console.error('[bot] backend check failed:', err.message);
  }

  if (registered === true) {
    return sendMenu(chatId, { userId5d: registeredInfo.userId5d });
  }

  if (registered === null) {
    // The backend did not answer (asleep, wrong secret, error). We cannot tell a new player from a registered one,
    // so NEVER show the plain menu here (a new player would get no register button at all): always send the
    // register/open button. The Mini App itself decides: registered players land on the home screen, new ones on the form.
    return safeSend(chatId, `እንኳን ወደ KING BINGO በደህና መጡ, @${username}! 👑\n\nለመጀመር ወይም ለመመዝገብ ከታች ያለውን ቁልፍ ይጫኑ።`, {
      reply_markup: {
        inline_keyboard: [[{ text: '📝 ተመዝገብ / 🎮 KING BINGO ክፈት', web_app: { url: appUrl(ref) } }], ...(supportRow() ? [supportRow()] : [])],
      },
    });
  }

  const sent = await safeSend(
    chatId,
    `እንኳን ወደ KING BINGO በደህና መጡ, @${username}! 👑\n\n` +
      'ለመጀመር መመዝገብ ያስፈልግዎታል። ከታች ያለውን ቁልፍ ተጭነው የምዝገባ ቅጹን ይሙሉ።' +
      (ref ? `\n\nየግብዣ ኮድ: ${ref}` : ''),
    {
      reply_markup: {
        inline_keyboard: [[{ text: '📝 ተመዝገብ', web_app: { url: appUrl(ref) } }], ...(supportRow() ? [supportRow()] : [])],
      },
    }
  );

  // let the backend know which message holds the "ተመዝገብ" button (not awaited: must never delay or block the reply)
  api('/api/bot/register-prompt', {
    method: 'POST',
    body: JSON.stringify({ telegramId, messageId: sent.message_id }),
  }).catch((err) => console.error('[bot] could not store register prompt:', err.message));
}

bot.onText(/\/start(?:\s+(\S+))?/, async (msg, match) => {
  try {
    await handleStart(msg, match);
  } catch (err) {
    console.error('[bot] /start failed:', err.message);
    // last-resort reply so the player is never left without an answer
    try {
      await safeSend(msg.chat.id, 'እንኳን ወደ KING BINGO በደህና መጡ! 👑', {
        reply_markup: { inline_keyboard: [[{ text: '📝 ተመዝገብ / 🎮 ክፈት', web_app: { url: MINI_APP_URL } }]] },
      });
    } catch (e2) {
      console.error('[bot] fallback /start failed:', e2.message);
    }
  }
});

bot.onText(/^\/menu(?:@\w+)?\s*$/i, async (msg) => {
  try {
    await handleStart(msg, null); // registered players get the picture menu, new players the register button
  } catch (err) {
    console.error('[bot] /menu failed:', err.message);
    try {
      await safeSend(msg.chat.id, '👑 KING BINGO — ዋና ማውጫ', {
        reply_markup: { inline_keyboard: [[{ text: '🎮 KING BINGO ክፈት', web_app: { url: MINI_APP_URL } }]] },
      });
    } catch (e2) {
      console.error('[bot] fallback /menu failed:', e2.message);
    }
  }
});

bot.onText(/\/support/, async (msg) => {
  const row = supportRow();
  if (!row) {
    return bot.sendMessage(msg.chat.id, 'Support ገና አልተዘጋጀም። እባክዎ ቆይተው ይሞክሩ።');
  }
  bot.sendMessage(msg.chat.id, 'ችግር ከገጠመዎት Admin ን ያነጋግሩ 👇', { reply_markup: { inline_keyboard: [row] } });
});

// ---- admin: "📋 የሂሳብ እንቅስቃሴዎች" (older request alerts that left the chat) ----
async function renderAlertsPage(telegramId, page) {
  const res = await api(`/api/bot/admin-alerts?telegramId=${telegramId}&page=${page}`);
  if (res.status === 403) return { text: 'ይህ ለ Admin ብቻ ነው።' };
  if (!res.ok) return { text: 'ዝርዝሩን ማምጣት አልተቻለም። እባክዎ እንደገና ይሞክሩ።' };
  const data = await res.json();
  if (data.total === 0) {
    return { text: '📋 የሂሳብ እንቅስቃሴዎች\n\nምንም የተቀመጠ ጥያቄ የለም። የቅርብ ጊዜዎቹ 3 ጥያቄዎች ከላይ በቻቱ ውስጥ ይገኛሉ።' };
  }
  const pages = Math.ceil(data.total / data.perPage);
  const body = data.items.map((i) => i.body.replace(/\n\nበ Admin Panel.*$/s, '')).join('\n\n━━━━━━━━━━\n\n');
  const nav = [];
  if (page > 0) nav.push({ text: '⬅️ አዲስ', callback_data: `acctp:${page - 1}` });
  if (page < pages - 1) nav.push({ text: 'ቀድሞ ➡️', callback_data: `acctp:${page + 1}` });
  return {
    text: `📋 የሂሳብ እንቅስቃሴዎች (${page + 1}/${pages})\n\n${body}`,
    reply_markup: nav.length ? { inline_keyboard: [nav] } : undefined,
  };
}

bot.on('callback_query', async (q) => {
  try {
    if (await handleJoinCallback(q)) return;
    const m = /^(acct|acctp):(\d+)$/.exec(q.data || '');
    if (!m) return bot.answerCallbackQuery(q.id);
    await bot.answerCallbackQuery(q.id);
    const page = Number(m[2]);
    const view = await renderAlertsPage(q.from.id, page);
    if (m[1] === 'acctp') {
      await bot.editMessageText(view.text, {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id,
        reply_markup: view.reply_markup,
      });
    } else {
      await bot.sendMessage(q.message.chat.id, view.text, { reply_markup: view.reply_markup });
    }
  } catch (err) {
    console.error('[bot] callback failed:', err.message);
  }
});

bot.on('polling_error', (err) => console.error('[bot] polling error:', err.message));

const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('King Bingo bot is running');
  })
  .listen(PORT, () => console.log(`[bot] health server listening on port ${PORT}`));

// Free hosts put idle services to sleep (a sleeping bot cannot answer /start). Ping ourselves and the backend
// every 10 minutes so both stay awake. RENDER_EXTERNAL_URL is set automatically on Render.
(function keepAlive() {
  const targets = [process.env.RENDER_EXTERNAL_URL, BACKEND_API_URL && `${BACKEND_API_URL}/health`].filter(Boolean);
  if (!targets.length) return;
  setInterval(() => {
    targets.forEach((u) => fetch(u, { timeout: 20000 }).catch((e) => console.error('[bot] keep-alive ping failed:', u, e.message)));
  }, 10 * 60 * 1000);
})();

start();
