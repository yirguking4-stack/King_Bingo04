const crypto = require('crypto');
const { query } = require('../config/db');
const { ensureAgentTables } = require('./agentTables');
const { ensureCbeTable } = require('./botTables');

// 10 characters, no look-alikes (0/O, 1/I/L) - easy to read out over the phone
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  let s = '';
  for (let i = 0; i < 10; i += 1) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

function hashCode(code, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(code).trim().toUpperCase(), salt, 32).toString('hex');
  return { salt, hash };
}

function verifyCode(code, salt, hash) {
  try {
    const a = Buffer.from(hashCode(code, salt).hash, 'hex');
    const b = Buffer.from(String(hash), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** The active agent row for a user, or null. */
async function activeAgentOf(userId) {
  await ensureAgentTables();
  const r = await query('SELECT * FROM agents WHERE user_id = $1 AND active = TRUE', [userId]);
  return r.rowCount ? r.rows[0] : null;
}

/**
 * Every account a player can pay to, grouped by method. `ref` is an opaque id the Deposit page sends back:
 *   S      = the admin's Telebirr (admin settings)      C<id> = one of the admin's CBE accounts
 *   A<id>  = the account of agent <id> (for the method it is listed under)
 */
async function paymentMethods() {
  await Promise.all([ensureAgentTables(), ensureCbeTable()]);
  const [tele, cbe, agents] = await Promise.all([
    query(`SELECT key, value FROM admin_settings WHERE key IN ('telebirr_account_name', 'telebirr_account_phone')`),
    query('SELECT id, account_name, account_number FROM cbe_accounts ORDER BY sort_order, id'),
    query(
      `SELECT a.* FROM agents a JOIN users u ON u.id = a.user_id
       WHERE a.active = TRUE AND u.status = 'ACTIVE' ORDER BY a.id`
    ),
  ]);
  const t = {};
  for (const row of tele.rows) t[row.key] = row.value;

  const TELEBIRR = [];
  if (t.telebirr_account_phone) TELEBIRR.push({ ref: 'S', agentId: null, name: t.telebirr_account_name || '', number: t.telebirr_account_phone });
  const CBE = cbe.rows.map((r) => ({ ref: `C${r.id}`, agentId: null, name: r.account_name, number: r.account_number }));
  for (const a of agents.rows) {
    if (a.telebirr_phone) TELEBIRR.push({ ref: `A${a.id}`, agentId: a.id, name: a.telebirr_name || '', number: a.telebirr_phone });
    if (a.cbe_number) CBE.push({ ref: `A${a.id}`, agentId: a.id, name: a.cbe_name || '', number: a.cbe_number });
  }
  return { TELEBIRR, CBE };
}

module.exports = { generateCode, hashCode, verifyCode, activeAgentOf, paymentMethods };
