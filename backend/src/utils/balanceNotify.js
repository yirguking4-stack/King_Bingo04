const { query } = require('../config/db');
const { tg } = require('./telegramApi');

/**
 * Tells a player (through the bot) when their balance changed: deposit/withdraw decisions,
 * bonuses, admin adjustments, prizes and refunds. Everything here is fire-and-forget:
 * it never throws and never delays the request or game logic that triggered it.
 * The player's own card purchases are intentionally NOT announced (they would be spam).
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// one message at a time, ~16/second, so a big refund/prize batch stays under Telegram's limits
let chain = Promise.resolve();
function enqueue(job) {
  chain = chain.then(job).catch(() => {}).then(() => sleep(60));
}

function fmt(n) {
  return Number(n).toFixed(2).replace(/\.?0+$/, '');
}

function openAppMarkup() {
  const url = process.env.MINI_APP_URL;
  if (!url || !/^https:\/\//i.test(url)) return undefined;
  return { inline_keyboard: [[{ text: '🎮 KING BINGO ክፈት', web_app: { url: url.replace(/\/$/, '') } }]] };
}

/** buildText(currentBalance) -> message text. The balance is read fresh from the database at send time. */
function send(userId, buildText) {
  enqueue(async () => {
    try {
      const r = await query(
        'SELECT u.telegram_id, w.balance FROM users u LEFT JOIN wallets w ON w.user_id = u.id WHERE u.id = $1',
        [userId]
      );
      if (r.rows.length === 0 || !r.rows[0].telegram_id) return;
      await tg('sendMessage', {
        chat_id: r.rows[0].telegram_id,
        text: buildText(Number(r.rows[0].balance || 0)),
        disable_web_page_preview: true,
        reply_markup: openAppMarkup(),
      });
    } catch (err) {
      console.error('[balance-notify] could not notify user', userId, err.message); // e.g. user blocked the bot
    }
  });
}

const balanceLine = (bal) => `💳 አዲስ ቀሪ ሒሳብ፦ ${fmt(bal)} ETB`;

/** After an admin approved/rejected a deposit or withdrawal. `notices` = bonuses granted by that approval. */
function notifyReviewResult(tx, notices = []) {
  if (!tx) return;
  const amt = fmt(tx.amount);
  const isDeposit = tx.type === 'VIRTUAL_DEPOSIT';
  const isWithdrawal = tx.type === 'VIRTUAL_WITHDRAWAL';

  if (tx.status === 'APPROVED') {
    if (isDeposit) {
      const bonus = notices.find((n) => String(n.userId) === String(tx.user_id) && n.reason === 'FIRST_JOIN_BONUS');
      send(tx.user_id, (bal) =>
        ['✅ Deposit ጸድቋል', `💰 +${amt} ETB`, bonus ? `🎁 የመጀመሪያ ቦነስ +${fmt(bonus.amount)} ETB` : null, balanceLine(bal)]
          .filter(Boolean)
          .join('\n')
      );
    } else if (isWithdrawal) {
      send(tx.user_id, (bal) => ['✅ Withdraw ጸድቋል', `💸 -${amt} ETB`, balanceLine(bal)].join('\n'));
    }
    notices
      .filter((n) => n.reason === 'REFERRAL_BONUS')
      .forEach((n) =>
        send(n.userId, (bal) => ['🎁 የግብዣ (Referral) ቦነስ ደርሶዎታል', `💰 +${fmt(n.amount)} ETB`, balanceLine(bal)].join('\n'))
      );
  } else if (tx.status === 'REJECTED' && (isDeposit || isWithdrawal)) {
    const what = isDeposit ? 'Deposit' : 'Withdraw';
    send(
      tx.user_id,
      () => `❌ ${what} ጥያቄዎ (${amt} ETB) አልጸደቀም።\nየላኩትን መረጃ ያረጋግጡና እንደገና ይሞክሩ፣ ወይም Support ያነጋግሩ።`
    );
  }
}

/** Admin manually credited / debited a player. */
function notifyAdminAdjust({ userId, direction, amount, reason }) {
  const credit = direction === 'CREDIT';
  send(userId, (bal) =>
    [
      credit ? '💰 ቀሪ ሒሳብዎ ተጨምሯል' : '➖ ቀሪ ሒሳብዎ ተቀንሷል',
      `${credit ? '+' : '-'}${fmt(amount)} ETB`,
      reason ? `📝 ${reason}` : null,
      balanceLine(bal),
    ]
      .filter(Boolean)
      .join('\n')
  );
}

/** A player won a game. */
function notifyPrize(userId, amount) {
  send(userId, (bal) => ['🏆 እንኳን ደስ አለዎት! BINGO አሸንፈዋል', `💰 +${fmt(amount)} ETB`, balanceLine(bal)].join('\n'));
}

/** A game was cancelled and the entry fee was returned. */
function notifyRefund(userId, amount) {
  send(userId, (bal) => ['↩️ ጨዋታው ተሰርዟል፣ የመግቢያ ክፍያዎ ተመልሷል', `💰 +${fmt(amount)} ETB`, balanceLine(bal)].join('\n'));
}

module.exports = { notifyReviewResult, notifyAdminAdjust, notifyPrize, notifyRefund };
