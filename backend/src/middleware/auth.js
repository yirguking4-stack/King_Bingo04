const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { adminAccess } = require('../utils/adminPerms');

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
async function requireAdmin(req, res, next) {
  try {
    if (req.user && req.user.is_admin) return next();
    // an ACTIVE agent may enter too - what he may DO is decided by requirePerm / requireOwner (his switches)
    const a = req.user ? await adminAccess(req.user) : null;
    if (a && a.admin) return next();
    return res.status(403).json({ error: 'Admin access required' });
  } catch (err) {
    console.error('[auth] admin check failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Requires an admin who may do AT LEAST ONE of the listed things (owners may do everything).
 * Must run after requireAuth + requireAdmin. Reads the permission from the database on every request.
 * Attaches req.adminAccess = { admin, owner, perms }.
 */
function requirePerm(...keys) {
  return async (req, res, next) => {
    try {
      const access = await adminAccess(req.user);
      if (!access.admin) return res.status(403).json({ error: 'Admin access required' });
      if (!keys.some((k) => access.perms[k] === true)) {
        return res.status(403).json({ error: 'ይህን ለማድረግ ፈቃድ የለዎትም። (No permission for this action)' });
      }
      req.adminAccess = access;
      return next();
    } catch (err) {
      console.error('[auth] permission check failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/** Only the owner (an admin without a permission row) - used for managing other admins. */
async function requireOwner(req, res, next) {
  try {
    const access = await adminAccess(req.user);
    if (!access.admin || !access.owner) return res.status(403).json({ error: 'Owner access required' });
    req.adminAccess = access;
    return next();
  } catch (err) {
    console.error('[auth] owner check failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** An agent works on his OWN deposit / withdrawal list (/api/agent) - never through the owner-wide transaction endpoints. */
function noAgent(req, res, next) {
  if (req.adminAccess && req.adminAccess.agent) return res.status(403).json({ error: 'ይህን ለማድረግ ፈቃድ የለዎትም። (No permission for this action)' });
  return next();
}

module.exports = { requireAuth, requireAdmin, requirePerm, requireOwner, noAgent };
