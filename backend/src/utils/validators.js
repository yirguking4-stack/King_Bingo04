/**
 * Ethiopian mobile number -> canonical 10-digit form (09XXXXXXXX / 07XXXXXXXX).
 * Accepts 09..., 9..., 2519..., +2519... (spaces/dashes ignored). Returns null if invalid.
 */
function normalizeEthioPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (/^251[79]\d{8}$/.test(d)) return '0' + d.slice(3);
  if (/^0[79]\d{8}$/.test(d)) return d;
  if (/^[79]\d{8}$/.test(d)) return '0' + d;
  return null;
}

/**
 * The account a player sent money from / wants money sent to: a Telebirr phone
 * (09XXXXXXXX) or a CBE account number (13 digits starting with 1000; SMS receipts
 * often mask the middle, e.g. 1000*********, so "*" is allowed). Returns null if invalid.
 */
function normalizeSenderAccount(raw) {
  const phone = normalizeEthioPhone(raw);
  if (phone) return phone;
  const v = String(raw || '').replace(/[\s-]/g, '');
  return /^1000[0-9*]{6,12}$/.test(v) ? v : null;
}

/** Telebirr transaction ID / number: 6-30 letters or digits, stored upper-case. */
function normalizeTxId(raw) {
  const v = String(raw || '').trim().toUpperCase();
  return /^[A-Z0-9]{6,30}$/.test(v) ? v : null;
}

/**
 * Only the first half of a username is shown, the rest is masked:
 * "Yirgalem" -> "Yirg****", "abc" -> "a**", "ab" -> "a*".
 * Same rule as the miniapp (src/services/mask.js), so masking twice gives the same result.
 */
function maskUsername(name) {
  const chars = [...String(name || '').replace(/^@/, '')];
  if (chars.length === 0) return '***';
  const visible = Math.floor(chars.length / 2);
  return chars.slice(0, visible).join('') + '*'.repeat(chars.length - visible);
}

module.exports = { normalizeEthioPhone, normalizeSenderAccount, normalizeTxId, maskUsername };
