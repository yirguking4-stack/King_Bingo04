/** Tiny wrapper around the Telegram Bot API (uses the backend's existing bot token). */
async function tg(method, payload) {
  if (typeof fetch !== 'function') throw new Error('fetch is not available (Node 18+ required)');
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`Telegram ${method} ${res.status}: ${String(data.description || '').slice(0, 160)}`);
  }
  return data.result;
}

module.exports = { tg };
