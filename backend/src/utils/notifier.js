const { query } = require('../config/db');

const { tg } = require('./telegramApi');
const { ensureBotTables } = require('./botTables');
const { ensureAgentTables } = require('./agentTables');

// How many request alerts stay visible in each admin's chat. Older ones move
// behind the "የሂሳብ እንቅስቃሴዎች" button.
const VISIBLE_ALERTS = 3;

/**
 * Sends a request alert to every active admin. Only the newest VISIBLE_ALERTS
 * stay in the chat: when a 4th arrives, the oldest one is removed from the chat
 * and kept (archived) so the admin can open it from the "📋 የሂሳብ እንቅስቃሴዎች" button.
 * Never throws (alerts must not break requests).
 */
async function notifyAdmins(text, kind = 'DEPOSIT', opts = {}) {
  try {
    await ensureBotTables();
    const admins = await query(`SELECT telegram_id FROM users WHERE is_admin = TRUE AND status = 'ACTIVE'`);
    // agents (deposit/withdrawal handlers) get the alert too: all of them for a withdrawal,
    // only the owner of the chosen account for a deposit (opts.agentIds = [..] or 'ALL')
    if (opts.agentIds && (opts.agentIds === 'ALL' || opts.agentIds.length)) {
      try {
        await ensureAgentTables();
        const ag = await query(
          `SELECT u.telegram_id FROM agents a JOIN users u ON u.id = a.user_id
            WHERE a.active = TRUE AND u.status = 'ACTIVE' AND ($1::text = 'ALL' OR a.id = ANY($2::int[]))`,
          [opts.agentIds === 'ALL' ? 'ALL' : 'LIST', opts.agentIds === 'ALL' ? [] : opts.agentIds]
        );
        const have = new Set(admins.rows.map((r) => String(r.telegram_id)));
        for (const r of ag.rows) if (!have.has(String(r.telegram_id))) admins.rows.push(r);
      } catch (err) {
        console.error('[notify] agents lookup failed (admins still notified):', err.message);
      }
    }

    const panel = process.env.ADMIN_PANEL_URL;
    const rows = [];
    // Approve / Reject right in Telegram (the bot checks again that the presser is an admin or an active agent)
    if (opts.txId) rows.push([{ text: '✅ Approve', callback_data: `rv:A:${opts.txId}` }, { text: '❌ Reject', callback_data: `rv:R:${opts.txId}` }]);
    rows.push([{ text: '📋 የሂሳብ እንቅስቃሴዎች', callback_data: 'acct:0' }]);
    if (panel && /^https:\/\//i.test(panel)) rows.push([{ text: '🛠 Admin Panel ክፈት', url: panel }]);
    const replyMarkup = { inline_keyboard: rows };

    await Promise.all(
      admins.rows.map(async (a) => {
        try {
          const sent = await tg('sendMessage', {
            chat_id: a.telegram_id,
            text,
            disable_web_page_preview: true,
            reply_markup: replyMarkup,
          });
          await query(
            'INSERT INTO admin_alerts (admin_telegram_id, message_id, kind, body) VALUES ($1, $2, $3, $4)',
            [a.telegram_id, sent.message_id, kind, text]
          );
          await archiveOldAlerts(a.telegram_id);
        } catch (err) {
          console.error(`[notify] admin ${a.telegram_id}:`, err.message);
        }
      })
    );
  } catch (err) {
    console.error('[notify] failed:', err.message);
  }
}

/** Removes everything older than the newest VISIBLE_ALERTS from the chat and marks it archived. */
async function archiveOldAlerts(adminTelegramId) {
  const old = await query(
    `SELECT id, message_id FROM admin_alerts
      WHERE admin_telegram_id = $1 AND archived = FALSE
      ORDER BY id DESC OFFSET $2`,
    [adminTelegramId, VISIBLE_ALERTS]
  );
  for (const row of old.rows) {
    try {
      await tg('deleteMessage', { chat_id: adminTelegramId, message_id: row.message_id });
    } catch (err) {
      // Telegram refuses to delete very old messages: shrink it instead so the chat stays tidy.
      await tg('editMessageText', {
        chat_id: adminTelegramId,
        message_id: row.message_id,
        text: '📋 ይህ ጥያቄ ወደ "የሂሳብ እንቅስቃሴዎች" ተዛውሯል።',
      }).catch(() => {});
    }
    await query('UPDATE admin_alerts SET archived = TRUE WHERE id = $1', [row.id]);
  }
}

function addisTime() {
  return new Date().toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa', hour12: false });
}

function depositAlertText({ user, amount, senderPhone, transactionId, hasScreenshot, payTo }) {
  return [
    '💰 አዲስ Deposit ጥያቄ',
    '',
    `👤 Player: @${user.username} (ID ${user.user_id_5d})`,
    `💵 መጠን: ${amount} ETB`,
    ...(payTo ? [`🏦 የተላከበት: ${payTo.method === 'CBE' ? 'CBE' : 'Telebirr'} — ${payTo.name || ''} ${payTo.number}`.replace('  ', ' ')] : []),
    `📱 ${payTo?.method === 'CBE' ? 'CBE' : payTo?.method === 'TELEBIRR' ? 'Telebirr' : 'Telebirr / CBE'} (የላከው) ቁጥር: ${senderPhone}`,
    ...(transactionId ? [`🧾 Transaction ID: ${transactionId}`] : []),
    ...(hasScreenshot ? ['📎 Screenshot አያይዟል (በ Admin Panel ይመልከቱ)'] : []),
    `🕒 ${addisTime()}`,
    '',
    'በ Admin Panel ወይም ከታች ባሉት ቁልፎች Approve ወይም Reject ያድርጉ።',
  ].join('\n');
}

function withdrawalAlertText({ user, amount, note }) {
  return [
    '💸 አዲስ Withdrawal ጥያቄ',
    '',
    `👤 Player: @${user.username} (ID ${user.user_id_5d})`,
    `💵 መጠን: ${amount} ETB`,
    `📝 ${note || '—'}`,
    `🕒 ${addisTime()}`,
    '',
    'በ Admin Panel ወይም ከታች ባሉት ቁልፎች Approve ወይም Reject ያድርጉ።',
  ].join('\n');
}

module.exports = { notifyAdmins, depositAlertText, withdrawalAlertText };
