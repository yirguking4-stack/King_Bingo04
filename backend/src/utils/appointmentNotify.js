const { query } = require('../config/db');
const { tg } = require('./telegramApi');
const { ensureAppointmentTables } = require('./botTables');
const { maskName } = require('./maskName');

const SEND_PER_SECOND = 20; // well under Telegram's ~30 messages/second limit
const MAX_BROADCASTS_PER_HOUR = 6; // flood guard: beyond this, suggestions are still listed but not pushed
const sentAt = []; // timestamps of recent broadcasts (in memory)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pushes a new "ቀጠሮ" suggestion to every active player through the bot
 * (except the author and anyone who switched notifications off).
 * Fire-and-forget: never throws and never delays the request that triggered it.
 */
function notifyNewAppointment({ authorUserId, body, authorName }) {
  (async () => {
    const now = Date.now();
    while (sentAt.length && now - sentAt[0] > 60 * 60 * 1000) sentAt.shift();
    if (sentAt.length >= MAX_BROADCASTS_PER_HOUR) {
      console.log('[appointments] push skipped (hourly limit reached)');
      return;
    }
    sentAt.push(now);

    await ensureAppointmentTables();
    const recipients = await query(
      `SELECT u.telegram_id
         FROM users u
         LEFT JOIN notification_prefs p ON p.user_id = u.id
        WHERE u.status = 'ACTIVE' AND u.id <> $1 AND COALESCE(p.appointments, TRUE) = TRUE`,
      [authorUserId]
    );

    const text = `🗓 አዲስ ቀጠሮ ሀሳብ\n\n"${body}"\n— @${maskName(authorName)}\n\nየሚስማሙ ከሆነ 👍 ይጫኑ 👇`;
    const url = process.env.MINI_APP_URL;
    const replyMarkup =
      url && /^https:\/\//i.test(url)
        ? { inline_keyboard: [[{ text: '🗓 ቀጠሮዎችን ክፈት', web_app: { url: `${url.replace(/\/$/, '')}/?tab=appointments` } }]] }
        : undefined;

    let ok = 0;
    for (let i = 0; i < recipients.rows.length; i += SEND_PER_SECOND) {
      const chunk = recipients.rows.slice(i, i + SEND_PER_SECOND);
      await Promise.all(
        chunk.map((r) =>
          tg('sendMessage', { chat_id: r.telegram_id, text, disable_web_page_preview: true, reply_markup: replyMarkup })
            .then(() => {
              ok += 1;
            })
            .catch(() => {}) // blocked the bot / chat unavailable: skip
        )
      );
      await sleep(1000);
    }
    console.log(`[appointments] pushed to ${ok}/${recipients.rows.length} players`);
  })().catch((err) => console.error('[appointments] push failed:', err.message));
}

module.exports = { notifyNewAppointment };
