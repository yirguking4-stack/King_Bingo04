const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

/**
 * Requires a valid JWT (issued after Telegram initData verification).
 * Attaches req.user = { id, telegram_id, user_id_5d, is_admin, ... }
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query(
      `SELECT id, telegram_id, user_id_5d, username, is_admin, status
       FROM users WHERE id = $1`,
      [decoded.sub]
    );

    if (result.rowCount === 0) return res.status(401).json({ error: 'User not found' });
    const user = result.rows[0];

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: `Account is ${user.status.toLowerCase()}` });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Requires req.user.is_admin === true. Must run after requireAuth.
 */
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
