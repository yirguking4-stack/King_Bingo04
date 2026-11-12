const { query } = require('../config/db');

/**
 * Per-admin permissions.
 *
 *  - An admin WITHOUT a row in admin_permissions is an OWNER: full access (this is every admin that existed
 *    before this feature, so nothing changes for them).
 *  - An admin WITH a row is a LIMITED admin: he can only do what the owner switched ON.
 *
 * The six switches (same names as the owner sees in the panel):
 *   adjust   - add / subtract a player's balance
 *   suspend  - suspend / ban / reactivate players
 *   approve  - see and approve / reject deposit and withdrawal requests
 *   games    - view King Bingo / King Ludo / King Dama status and history (view only)
 *   audit    - read all audit logs
 *   settings - every Settings page action (Telebirr / CBE, agents, menu picture, Dama configuration)
 */
const PERMISSIONS = ['adjust', 'suspend', 'approve', 'games', 'audit', 'settings'];

let ready = null;
function ensureAdminTables() {
  if (!ready) {
    ready = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS admin_permissions (
          user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          adjust     BOOLEAN NOT NULL DEFAULT FALSE,
          suspend    BOOLEAN NOT NULL DEFAULT FALSE,
          approve    BOOLEAN NOT NULL DEFAULT FALSE,
          games      BOOLEAN NOT NULL DEFAULT FALSE,
          audit      BOOLEAN NOT NULL DEFAULT FALSE,
          settings   BOOLEAN NOT NULL DEFAULT FALSE,
          code_salt  TEXT NOT NULL,
          code_hash  TEXT NOT NULL,
          created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** The permission row of a limited admin, or null (= owner / not a limited admin). */
async function limitedRow(userId) {
  await ensureAdminTables();
  const r = await query('SELECT * FROM admin_permissions WHERE user_id = $1', [userId]);
  return r.rowCount ? r.rows[0] : null;
}

function permsOf(row) {
  const o = {};
  for (const p of PERMISSIONS) o[p] = row ? row[p] === true : true;
  return o;
}

/**
 * What may this user do as an admin?  { admin, owner, perms }
 * Checked against the database on every call, so switching a permission off (or removing the admin) is immediate.
 */
async function adminAccess(user) {
  if (!user || !user.is_admin || user.status !== 'ACTIVE') return { admin: false, owner: false, perms: permsOf({}) };
  const row = await limitedRow(user.id);
  return { admin: true, owner: !row, perms: permsOf(row) };
}

async function adminCan(user, perm) {
  const a = await adminAccess(user);
  return a.admin && a.perms[perm] === true;
}

module.exports = { PERMISSIONS, ensureAdminTables, limitedRow, permsOf, adminAccess, adminCan };
