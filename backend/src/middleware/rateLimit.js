/**
 * Very small in-memory rate limiter (per client IP).
 * Good enough for a single Render instance.
 */
function rateLimit({ windowMs, max }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: 'ብዙ ሙከራ ተደርጓል። ከ15 ደቂቃ በኋላ እንደገና ይሞክሩ።' });
    }
    next();
  };
}

module.exports = { rateLimit };
