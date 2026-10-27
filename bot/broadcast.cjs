'use strict';
// King Bingo - admin broadcast through the bot (node-telegram-bot-api).
// Admin flow:  /broadcast  ->  send the announcement  ->  preview  ->  [✅ ላክ] / [❌ ሰርዝ]
// Works with any message type (text, photo, video, file + caption) because it uses copyMessage.
// Admins are listed in the bot service env var ADMIN_IDS (comma separated Telegram IDs).

const ADMIN_IDS = String(process.env.ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const BACKEND = String(process.env.BACKEND_API_URL || '').replace(/\/+$/, '');
const SECRET = process.env.BOT_INTERNAL_SECRET || '';
const DELAY_MS = 45; // ~22 messages / second, below Telegram's ~30/s limit

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAdmin = (id) => ADMIN_IDS.includes(String(id));

module.exports = function registerBroadcast(bot) {
  if (!ADMIN_IDS.length) {
    console.warn('[broadcast] ADMIN_IDS is not set - /broadcast is disabled');
  }
  const state = new Map(); // adminId -> { step, src }
  let running = false;

  const token = () => bot.token || process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';

  async function tg(method, payload) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await r.json();
    } catch (e) {
      return { ok: false, error_code: 0, description: 'network' };
    }
  }

  async function sendOne(chatId, src) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const j = await tg('copyMessage', {
        chat_id: chatId,
        from_chat_id: src.chatId,
        message_id: src.messageId,
      });
      if (j.ok) return 'ok';
      if (j.error_code === 429) {
        const wait = ((j.parameters && j.parameters.retry_after) || 5) * 1000 + 500;
        await sleep(wait);
        continue;
      }
      if (j.error_code === 403) return 'blocked';
      return 'failed';
    }
    return 'failed';
  }

  async function run(adminChat, src) {
    const rr = await fetch(`${BACKEND}/api/broadcast/recipients`, {
      headers: { 'x-bot-secret': SECRET },
    });
    if (!rr.ok) throw new Error('recipients request failed: ' + rr.status);
    const data = await rr.json();
    const ids = Array.isArray(data.ids) ? data.ids : [];
    await bot.sendMessage(adminChat, `📤 ለ ${ids.length} ተጠቃሚዎች መላክ ተጀምሯል...`);

    let ok = 0;
    let blocked = 0;
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      const res = await sendOne(ids[i], src);
      if (res === 'ok') ok++;
      else if (res === 'blocked') blocked++;
      else failed++;
      await sleep(DELAY_MS);
      if ((i + 1) % 500 === 0 && i + 1 < ids.length) {
        await bot.sendMessage(adminChat, `⏳ ${i + 1} / ${ids.length}`);
      }
    }
    console.log(`[broadcast] done ok=${ok} blocked=${blocked} failed=${failed}`);
    await bot.sendMessage(
      adminChat,
      '✅ ማስታወቂያው ተጠናቋል\n\n' +
        `📬 ደረሰ: ${ok}\n` +
        `🚫 ያገዱ / Start ያላደረጉ: ${blocked}\n` +
        `⚠️ ሌላ ስህተት: ${failed}\n` +
        `👥 ጠቅላላ: ${ids.length}`
    );
  }

  bot.onText(/^\/broadcast(?:@\w+)?\s*$/i, async (msg) => {
    if (!msg.from || msg.chat.type !== 'private' || !isAdmin(msg.from.id)) return;
    if (running) {
      return bot.sendMessage(msg.chat.id, '⏳ ሌላ ማስታወቂያ በመላክ ላይ ነው። እባክዎ ይጠብቁ።');
    }
    state.set(String(msg.from.id), { step: 'content' });
    return bot.sendMessage(
      msg.chat.id,
      '📢 ለሁሉም ተጠቃሚ የሚላከውን ማስታወቂያ አሁን ይላኩ።\n' +
        '(ጽሑፍ፣ ምስል፣ ቪዲዮ ወይም ፋይል ከጽሑፍ ጋር ይቻላል)\n\n' +
        'ለመሰረዝ: /cancel'
    );
  });

  bot.onText(/^\/cancel(?:@\w+)?\s*$/i, async (msg) => {
    if (!msg.from || !isAdmin(msg.from.id)) return;
    if (state.delete(String(msg.from.id))) {
      return bot.sendMessage(msg.chat.id, '❌ ማስታወቂያው ተሰርዟል።');
    }
  });

  bot.on('message', async (msg) => {
    try {
      if (!msg.from || msg.chat.type !== 'private') return;
      const st = state.get(String(msg.from.id));
      if (!st || st.step !== 'content' || !isAdmin(msg.from.id)) return;
      if (typeof msg.text === 'string' && msg.text.startsWith('/')) return;

      st.step = 'confirm';
      st.src = { chatId: msg.chat.id, messageId: msg.message_id };
      await bot.sendMessage(msg.chat.id, '👇 የማስታወቂያው ቅድመ እይታ፦');
      await tg('copyMessage', {
        chat_id: msg.chat.id,
        from_chat_id: msg.chat.id,
        message_id: msg.message_id,
      });
      await bot.sendMessage(msg.chat.id, 'ለሁሉም ተጠቃሚ ልላክ?', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ ላክ', callback_data: 'bc:send' },
              { text: '❌ ሰርዝ', callback_data: 'bc:cancel' },
            ],
          ],
        },
      });
    } catch (e) {
      console.error('[broadcast] message handler error:', e && e.message);
    }
  });

  bot.on('callback_query', async (q) => {
    const data = (q && q.data) || '';
    if (!data.startsWith('bc:')) return;
    try {
      if (!isAdmin(q.from.id)) return bot.answerCallbackQuery(q.id);
      const key = String(q.from.id);
      const chatId = q.message.chat.id;
      const st = state.get(key);

      // remove the buttons so they cannot be pressed twice
      bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: chatId, message_id: q.message.message_id }
      ).catch(() => {});

      if (data === 'bc:cancel') {
        state.delete(key);
        await bot.answerCallbackQuery(q.id, { text: 'ተሰርዟል' });
        return bot.sendMessage(chatId, '❌ ማስታወቂያው ተሰርዟል።');
      }

      if (data === 'bc:send') {
        if (!st || st.step !== 'confirm') {
          return bot.answerCallbackQuery(q.id, { text: 'ጊዜው አልፏል። /broadcast ን እንደገና ይጀምሩ።', show_alert: true });
        }
        if (running) {
          return bot.answerCallbackQuery(q.id, { text: 'ሌላ ማስታወቂያ በመላክ ላይ ነው።', show_alert: true });
        }
        running = true;
        state.delete(key);
        await bot.answerCallbackQuery(q.id, { text: 'መላክ ተጀምሯል' });
        try {
          await run(chatId, st.src);
        } catch (e) {
          console.error('[broadcast] run error:', e && e.message);
          await bot.sendMessage(chatId, '⚠️ መላክ አልተሳካም። ቆይተው እንደገና ይሞክሩ።');
        } finally {
          running = false;
        }
      }
    } catch (e) {
      console.error('[broadcast] callback error:', e && e.message);
    }
  });
};
