const { query, withTransaction } = require('../config/db');

function pad5(n) {
  return String(n).padStart(5, '0');
}

let sequenceReady = false;

/**
 * Dedicated counter for Player IDs. A NEW sequence (player_id_seq) is used on
 * purpose so it always starts cleanly at 00002 (00001 is already taken),
 * whatever state the old user_id_5d_seq is in. Created once, idempotent.
 */
async function ensureSequence(runner) {
  if (sequenceReady) return;
  await runner.query('CREATE SEQUENCE IF NOT EXISTS player_id_seq START 2 MINVALUE 1 MAXVALUE 99999');
  sequenceReady = true;
}

/**
 * Next Player ID in strict order: 00002, 00003, 00004 ...
 * IDs that are already taken (the early randomly-assigned ones such as
 * 42207, 00001, 42206, 32663) are skipped automatically when the counter
 * reaches them, so nobody ever gets a duplicate.
 */
async function generateUnique5DigitId(client) {
  const runner = client || { query };
  await ensureSequence({ query });
  for (let i = 0; i < 1000; i++) {
    const result = await runner.query("SELECT nextval('player_id_seq') AS n");
    const n = Number(result.rows[0].n);
    const id = pad5(n);
    const taken = await runner.query('SELECT 1 FROM users WHERE user_id_5d = $1', [id]);
    if (taken.rowCount === 0) return id;
  }
  throw new Error('Could not allocate a Player ID');
}

async function findByTelegramId(telegramId) {
  const res = await query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  return res.rows[0] || null;
}

async function findByUserId5d(userId5d) {
  const res = await query('SELECT * FROM users WHERE user_id_5d = $1', [userId5d]);
  return res.rows[0] || null;
}

/**
 * Registers a new real user. Requires a Telegram username (guardrail enforced
 * upstream) and creates their wallet with a 0.00 virtual credit balance.
 */
async function registerUser({ telegramId, username, firstName, lastName, phoneNumber, referredBy }) {
  return withTransaction(async (client) => {
    // guard against duplicate self-referral / invalid referrer
    let validReferrer = null;
    if (referredBy) {
      const ref = await client.query('SELECT user_id_5d FROM users WHERE user_id_5d = $1', [referredBy]);
      if (ref.rowCount > 0) validReferrer = ref.rows[0].user_id_5d;
    }

    const userId5d = await generateUnique5DigitId(client);

    const insertUser = await client.query(
      `INSERT INTO users (telegram_id, user_id_5d, username, first_name, last_name, phone_number, referred_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [telegramId, userId5d, username, firstName || null, lastName || null, phoneNumber || null, validReferrer]
    );
    const user = insertUser.rows[0];

    await client.query('INSERT INTO wallets (user_id, balance, locked_balance) VALUES ($1, 0, 0)', [user.id]);

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, 'USER_REGISTERED', 'user', $1, $2)`,
      [user.id, JSON.stringify({ referredBy: validReferrer })]
    );

    return user;
  });
}

async function setPhoneNumber(userId, phoneNumber) {
  const res = await query(
    `UPDATE users SET phone_number = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [userId, phoneNumber]
  );
  return res.rows[0];
}

async function getWallet(userId) {
  const res = await query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
  return res.rows[0] || null;
}

module.exports = {
  pad5,
  generateUnique5DigitId,
  findByTelegramId,
  findByUserId5d,
  registerUser,
  setPhoneNumber,
  getWallet,
};
