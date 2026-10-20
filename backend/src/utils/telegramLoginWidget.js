const crypto = require('crypto');

/**
 * Verifies data from Telegram's official Login Widget
 * (https://core.telegram.org/widgets/login#checking-authorization).
 * This uses a different HMAC scheme than Mini App initData verification:
 * the secret key is SHA256(bot_token), not HMAC("WebAppData", bot_token).
 */
function verifyLoginWidgetData(payload, botToken) {
  const { hash, ...rest } = payload;
  if (!hash) return false;

  const dataCheckString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return false;

  // auth_date should be recent (protect against replay of old widget payloads)
  const authDate = Number(rest.auth_date);
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > 86400) return false; // reject if older than 24h

  return true;
}

module.exports = { verifyLoginWidgetData };
