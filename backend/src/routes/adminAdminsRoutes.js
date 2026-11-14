const express = require('express');
const { query, withTransaction } = require('../config/db');
const { requireAuth, requireAdmin, requireOwner } = require('../middleware/auth');
const userModel = require('../models/userModel');
const { generateCode, hashCode } = require('../utils/agents');
const { ensureAgentTables } = require('../utils/agentTables');
const { PERMISSIONS, ensureAdminTables } = require('../utils/adminPerms');

/**
 * Managing the OTHER admins - OWNER ONLY (an admin that has no permission row).  /api/admin/admins
 * A limited admin never sees or reaches this, whatever switches are on for him.
 */
const router = express.Router();
router.use(requireAuth, requireAdmin, requireOwner);

const normUsername = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();

const SELECT_ADMIN = `SELECT p.*, u.user_id_5d, u.username, u.status FROM admin_permissions p JOIN users u ON u.id = p.user_id`;

const publicAdmin = (r) => ({
  userId: r.user_id,
  userId5d: r.user_id_5d,
  username: r.username,
  status: r.status,
  permissions: Object.fromEntries(PERMISSIONS.map((p) => [p, r[p] === true])),
  createdAt: r.created_at,
});

// only an explicit `true` switches something on
function cleanPerms(input) {
  const src = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(PERMISSIONS.map((p) => [p, src[p] === true]));
}

async function audit(actorId, action, targetUserId, metadata = {}) {
  await query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata) VALUES ($1, $2, 'admin', $3, $4)`,
    [actorId, action, targetUserId, JSON.stringify(metadata)]
  );
}

router.get('/', async (req, res) => {
  await ensureAdminTables();
  const r = await query(`${SELECT_ADMIN} ORDER BY p.created_at`);
  res.json(r.rows.map(publicAdmin));
});

// make a player a limited admin. His personal login code is returned ONCE - only its hash is stored.
router.post('/', async (req, res) => {
  await Promise.all([ensureAdminTables(), ensureAgentTables()]);
  const playerId = String(req.body.playerId || '').trim();
  if (!/^[0-9]{5}$/.test(playerId)) return res.status(400).json({ error: 'Player ID 5 ቁጥር መሆን አለበት (ለምሳሌ 00005)።' });
  const user = await userModel.findByUserId5d(playerId);
  if (!user) return res.status(404).json({ error: `Player ID ${playerId} አልተገኘም።` });
  if (!normUsername(req.body.username) || normUsername(user.username) !== normUsername(req.body.username)) {
    return res.status(400).json({ error: 'Player ID እና Username አይዛመዱም። ሁለቱንም በትክክል ያስገቡ።' });
  }
  if (user.status !== 'ACTIVE') return res.status(400).json({ error: 'ይህ አካውንት ንቁ አይደለም።' });
  if (user.is_admin) {
    // an existing full-access admin (owner) can be limited here - but never yourself
    if (String(user.id) === String(req.user.id)) return res.status(400).json({ error: 'ራስዎን መገደብ አይችሉም።' });
    const already = await query('SELECT 1 FROM admin_permissions WHERE user_id = $1', [user.id]);
    if (already.rowCount) return res.status(409).json({ error: 'ይህ ሰው አስቀድሞ ገደብ ያለው Admin ነው። ማብሪያዎቹን ከዝርዝሩ ያስተካክሉ።' });
  }
  const isAgent = await query('SELECT 1 FROM agents WHERE user_id = $1', [user.id]);
  if (isAgent.rowCount) return res.status(409).json({ error: 'ይህ ተጫዋች Agent ነው። መጀመሪያ ከ Agent ዝርዝር ያስወግዱት።' });

  const perms = cleanPerms(req.body.permissions);
  const code = generateCode();
  const { salt, hash } = hashCode(code);
  await withTransaction(async (client) => {
    await client.query('UPDATE users SET is_admin = TRUE, updated_at = now() WHERE id = $1', [user.id]);
    await client.query(
      `INSERT INTO admin_permissions (user_id, adjust, suspend, approve, games, audit, settings, code_salt, code_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [user.id, perms.adjust, perms.suspend, perms.approve, perms.games, perms.audit, perms.settings, salt, hash, req.user.id]
    );
  });
  await audit(req.user.id, 'ADMIN_ADDED', user.id, { playerId, permissions: perms });
  const row = (await query(`${SELECT_ADMIN} WHERE p.user_id = $1`, [user.id])).rows[0];
  res.status(201).json({ admin: publicAdmin(row), code });
});

// change the switches
router.put('/:userId', async (req, res) => {
  await ensureAdminTables();
  const id = parseInt(req.params.userId, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const perms = cleanPerms(req.body.permissions);
  const r = await query(
    `UPDATE admin_permissions SET adjust = $2, suspend = $3, approve = $4, games = $5, audit = $6, settings = $7, updated_at = now()
      WHERE user_id = $1 RETURNING user_id`,
    [id, perms.adjust, perms.suspend, perms.approve, perms.games, perms.audit, perms.settings]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'Admin not found' });
  await audit(req.user.id, 'ADMIN_PERMISSIONS_CHANGED', id, { permissions: perms });
  const row = (await query(`${SELECT_ADMIN} WHERE p.user_id = $1`, [id])).rows[0];
  res.json(publicAdmin(row));
});

router.post('/:userId/reset-code', async (req, res) => {
  await ensureAdminTables();
  const id = parseInt(req.params.userId, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const code = generateCode();
  const { salt, hash } = hashCode(code);
  const r = await query('UPDATE admin_permissions SET code_salt = $2, code_hash = $3, updated_at = now() WHERE user_id = $1 RETURNING user_id', [id, salt, hash]);
  if (!r.rowCount) return res.status(404).json({ error: 'Admin not found' });
  await audit(req.user.id, 'ADMIN_CODE_RESET', id);
  res.json({ code });
});

// take the admin role away completely
router.delete('/:userId', async (req, res) => {
  await ensureAdminTables();
  const id = parseInt(req.params.userId, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const removed = await withTransaction(async (client) => {
    const d = await client.query('DELETE FROM admin_permissions WHERE user_id = $1 RETURNING user_id', [id]);
    if (!d.rowCount) return false;
    await client.query('UPDATE users SET is_admin = FALSE, updated_at = now() WHERE id = $1', [id]);
    return true;
  });
  if (!removed) return res.status(404).json({ error: 'Admin not found' });
  await audit(req.user.id, 'ADMIN_REMOVED', id);
  res.json({ ok: true });
});

module.exports = router;
