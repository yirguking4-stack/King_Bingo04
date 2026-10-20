const { query } = require('../config/db');
const { tg } = require('../utils/telegramApi');

// Fire-and-forget Telegram messages for Ludo prizes/refunds. Never throws, never blocks game logic.
const fmt = (n) => Number(n).toFixed(2).replace(/\.?0+$/, '');

async function send(userId, build) {
  try {
    const r = await query('SELECT u.telegram_id, w.balance FROM users u LEFT JOIN wallets w ON w.user_id = u.id WHERE u.id = $1', [userId]);
    if (!r.rows[0] || !r.rows[0].telegram_id) return;
    await tg('sendMessage', { chat_id: r.rows[0].telegram_id, text: build(Number(r.rows[0].balance || 0)), disable_web_page_preview: true });
  } catch (e) {
    console.error('[ludo-notify]', userId, e.message);
  }
}

const notifyLudoPrize = (userId, amount) =>
  send(userId, (bal) => `🏆 እንኳን ደስ አለዎት! KING LUDO አሸንፈዋል\n💰 +${fmt(amount)} ETB\n💳 አዲስ ቀሪ ሒሳብ፦ ${fmt(bal)} ETB`);
const notifyLudoRefund = (userId, amount) =>
  send(userId, (bal) => `↩️ KING LUDO: ተጋጣሚ ስላልመጣ የመግቢያ ክፍያዎ ተመልሷል\n💰 +${fmt(amount)} ETB\n💳 አዲስ ቀሪ ሒሳብ፦ ${fmt(bal)} ETB`);

module.exports = { notifyLudoPrize, notifyLudoRefund };
