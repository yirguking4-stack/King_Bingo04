const crypto = require('crypto');

/**
 * Verifies the `initData` string sent by the Telegram Mini App (via
 * @twa-dev/sdk's WebApp.initData) according to Telegram's documented
 * HMAC-SHA256 verification scheme.
 *
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function verifyInitData(initData, botToken) {
  if (!initData || typeof initData !== 'string') return { valid: false };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { valid: false };

  params.delete('hash');

  const dataCheckArr = [];
  for (const [key, value] of [...params.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    dataCheckArr.push(`${key}=${value}`);
  }
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computedHash, 'utf8');
  const b = Buffer.from(String(hash), 'utf8');
  let valid = a.length === b.length && crypto.timingSafeEqual(a, b);

  // reject old / replayed initData (older than 24h)
  const authDateNum = Number(params.get('auth_date'));
  if (!authDateNum || Date.now() / 1000 - authDateNum > 86400) valid = false;

  let user = null;
  const userRaw = params.get('user');
  if (valid && userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch (e) {
      user = null;
    }
  }

  const authDate = params.get('auth_date');
  const startParam = params.get('start_param') || null;

  return { valid, user, authDate, startParam };
}

module.exports = { verifyInitData };
