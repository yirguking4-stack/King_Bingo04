const { withTransaction } = require('../config/db');

const FIRST_JOIN_BONUS = 50.0; // virtual credits, locked until 1 game played
const REFERRAL_BONUS = 20.0; // virtual credits, credited to referrer

/**
 * Creates a PENDING virtual-credit deposit request. This does not move any
 * real money — it only records that the player is requesting the admin
 * grant them virtual credits (e.g. after a promotional top-up, or after
 * arranging credit some other way outside the bot). The bot never
 * automates a real-money transfer here.
 */
async function requestVirtualDeposit(userId, amount, { senderPhone, paymentReference, proof, routing }) {
  return withTransaction(async (client) => {
    const wallet = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    const balanceBefore = Number(wallet.rows[0].balance);

    const tx = await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status, reference_note, sender_phone, payment_reference)
       VALUES ($1, 'VIRTUAL_DEPOSIT', $2, $3, $3, 'PENDING', $4, $5, $6)
       RETURNING *`,
      [
        userId,
        amount,
        balanceBefore,
        `${/^0[79]\d{8}$/.test(senderPhone) ? 'Telebirr' : 'CBE'}: ${senderPhone} | ${paymentReference ? `TXN: ${paymentReference}` : 'Screenshot'}`,
        senderPhone,
        paymentReference || null,
      ]
    );
    if (proof) {
      await client.query(
        'INSERT INTO deposit_proofs (transaction_id, mime, data, sha256) VALUES ($1, $2, $3, $4)',
        [tx.rows[0].id, proof.mime, proof.data, proof.sha256]
      );
    }
    // which account the player paid to (admin or an agent) - decides who gets the alert / may approve
    if (routing) {
      await client.query('INSERT INTO deposit_routing (transaction_id, agent_id, method) VALUES ($1, $2, $3)', [tx.rows[0].id, routing.agentId, routing.method]);
    }
    return tx.rows[0];
  });
}

/**
 * Creates a PENDING virtual-credit withdrawal request (removes credits from
 * the in-game economy; has no real-world payout attached).
 */
async function requestVirtualWithdrawal(userId, amount, note) {
  return withTransaction(async (client) => {
    const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    const wallet = walletRes.rows[0];
    const withdrawable = Number(wallet.balance) - Number(wallet.locked_balance);

    if (amount > withdrawable) {
      const err = new Error('ማውጣት የሚችሉት ቀሪ ሂሳብ (ETB) በቂ አይደለም');
      err.code = 'INSUFFICIENT_BALANCE';
      throw err;
    }

    const tx = await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status, reference_note)
       VALUES ($1, 'VIRTUAL_WITHDRAWAL', $2, $3, $3, 'PENDING', $4)
       RETURNING *`,
      [userId, amount, wallet.balance, note || null]
    );
    return tx.rows[0];
  });
}

/**
 * Admin approves or rejects a pending transaction. Only on APPROVE does the
 * wallet balance actually change — this is the "real admin workflow acting
 * on a virtual ledger" pattern.
 */
async function reviewTransaction(transactionId, adminUserId, decision) {
  if (!['APPROVED', 'REJECTED'].includes(decision)) throw new Error('Invalid decision');

  return withTransaction(async (client) => {
    const txRes = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [transactionId]);
    if (txRes.rowCount === 0) throw new Error('Transaction not found');
    const tx = txRes.rows[0];
    if (tx.status !== 'PENDING') throw new Error('Transaction already reviewed');

    let newBalanceAfter = tx.balance_before;
    const notices = []; // bonuses granted by this approval (used to notify the players afterwards)

    if (decision === 'APPROVED') {
      const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [tx.user_id]);
      const wallet = walletRes.rows[0];

      if (tx.type === 'VIRTUAL_DEPOSIT') {
        newBalanceAfter = Number(wallet.balance) + Number(tx.amount);
        await client.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE user_id = $1', [
          tx.user_id,
          newBalanceAfter,
        ]);

        // first-ever approved deposit -> bonus + referral payout.
        // Lock the depositor's row so two simultaneous approvals can never both count as "first".
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [tx.user_id]);
        const priorDeposits = await client.query(
          `SELECT COUNT(*) FROM transactions WHERE user_id = $1 AND type = 'VIRTUAL_DEPOSIT' AND status = 'APPROVED'`,
          [tx.user_id]
        );
        if (Number(priorDeposits.rows[0].count) === 0) {
          await grantFirstJoinBonus(client, tx.user_id);
          notices.push({ userId: tx.user_id, amount: FIRST_JOIN_BONUS, reason: 'FIRST_JOIN_BONUS' });
          const referrerId = await grantReferralBonusIfEligible(client, tx.user_id);
          if (referrerId) notices.push({ userId: referrerId, amount: REFERRAL_BONUS, reason: 'REFERRAL_BONUS' });
        }
      } else if (tx.type === 'VIRTUAL_WITHDRAWAL') {
        if (Number(wallet.balance) < Number(tx.amount)) {
          throw new Error('Wallet balance insufficient at review time');
        }
        newBalanceAfter = Number(wallet.balance) - Number(tx.amount);
        await client.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE user_id = $1', [
          tx.user_id,
          newBalanceAfter,
        ]);
      }
    }

    const updated = await client.query(
      `UPDATE transactions
       SET status = $2, reviewed_by = $3, reviewed_at = now(), balance_after = $4
       WHERE id = $1 RETURNING *`,
      [transactionId, decision, adminUserId, newBalanceAfter]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, 'transaction', $3, $4)`,
      [adminUserId, `TRANSACTION_${decision}`, transactionId, JSON.stringify({ type: tx.type, amount: tx.amount })]
    );

    const row = updated.rows[0];
    Object.defineProperty(row, 'notices', { value: notices, enumerable: false }); // not part of the JSON response
    return row;
  });
}

async function grantFirstJoinBonus(client, userId) {
  const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
  const wallet = walletRes.rows[0];
  const newBalance = Number(wallet.balance) + FIRST_JOIN_BONUS;
  const newLocked = Number(wallet.locked_balance) + FIRST_JOIN_BONUS;

  await client.query('UPDATE wallets SET balance = $2, locked_balance = $3, updated_at = now() WHERE user_id = $1', [
    userId,
    newBalance,
    newLocked,
  ]);

  await client.query(
    `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status)
     VALUES ($1, 'FIRST_JOIN_BONUS', $2, $3, $4, 'COMPLETED')`,
    [userId, FIRST_JOIN_BONUS, wallet.balance, newBalance]
  );
}

async function grantReferralBonusIfEligible(client, newUserId) {
  const userRes = await client.query('SELECT referred_by, user_id_5d FROM users WHERE id = $1', [newUserId]);
  const referredBy = userRes.rows[0].referred_by;
  const newUserId5d = userRes.rows[0].user_id_5d;
  if (!referredBy) return;

  const referrerRes = await client.query('SELECT id FROM users WHERE user_id_5d = $1', [referredBy]);
  if (referrerRes.rowCount === 0) return;
  const referrerId = referrerRes.rows[0].id;

  // Extra safety: one commission per invited player, ever.
  const note = `የተጋበዘ ተጫዋች ${newUserId5d} የመጀመሪያ deposit`;
  const already = await client.query(
    `SELECT 1 FROM transactions WHERE user_id = $1 AND type = 'REFERRAL_BONUS' AND reference_note = $2`,
    [referrerId, note]
  );
  if (already.rowCount > 0) return;

  const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [referrerId]);
  const wallet = walletRes.rows[0];
  const newBalance = Number(wallet.balance) + REFERRAL_BONUS;

  await client.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE user_id = $1', [
    referrerId,
    newBalance,
  ]);

  await client.query(
    `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status, reference_note)
     VALUES ($1, 'REFERRAL_BONUS', $2, $3, $4, 'COMPLETED', $5)`,
    [referrerId, REFERRAL_BONUS, wallet.balance, newBalance, note]
  );

  return referrerId; // caller may use this to push a realtime/notification event
}

/**
 * Unlocks bonus credit once the player has completed >=1 real game entry.
 */
async function unlockBonusAfterFirstGame(client, userId) {
  const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
  const wallet = walletRes.rows[0];
  if (Number(wallet.locked_balance) <= 0) return;

  await client.query('UPDATE wallets SET locked_balance = 0, updated_at = now() WHERE user_id = $1', [userId]);
}

module.exports = {
  FIRST_JOIN_BONUS,
  REFERRAL_BONUS,
  requestVirtualDeposit,
  requestVirtualWithdrawal,
  reviewTransaction,
  grantFirstJoinBonus,
  grantReferralBonusIfEligible,
  unlockBonusAfterFirstGame,
};
