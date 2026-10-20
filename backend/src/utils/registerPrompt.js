const { query } = require('../config/db');
const { tg } = require('./telegramApi');
const { ensureBotTables } = require('./botTables');

/**
 * After a player registers AND taps "Back to home" in the Mini App, the "📝 ተመዝገብ" message the bot sent must lose its
 * button (nobody needs to register twice). The message is rewritten to a
 * confirmation; if MINI_APP_URL is set on the backend it gets the game button instead.
 * Fire-and-forget: never throws.
 */
function closeRegisterPrompts(telegramId) {
  (async () => {
    await ensureBotTables();
    const rows = await query('SELECT message_id FROM bot_register_prompts WHERE telegram_id = $1', [telegramId]);
    const url = process.env.MINI_APP_URL;
    const replyMarkup =
      url && /^https:\/\//i.test(url)
        ? { inline_keyboard: [[{ text: '🎮 KING BINGO ክፈት', web_app: { url } }]] }
        : { inline_keyboard: [] };

    for (const r of rows.rows) {
      await tg('editMessageText', {
        chat_id: telegramId,
        message_id: r.message_id,
        text: '✅ ምዝገባው ተጠናቋል! 👑\nጨዋታውን ለመጀመር ከታች ያለውን ቁልፍ ይጫኑ ወይም /start ይላኩ።',
        reply_markup: replyMarkup,
      }).catch((err) => console.error('[register-prompt] edit failed:', err.message));
    }
    await query('DELETE FROM bot_register_prompts WHERE telegram_id = $1', [telegramId]);
  })().catch((err) => console.error('[register-prompt]', err.message));
}

module.exports = { closeRegisterPrompts };
