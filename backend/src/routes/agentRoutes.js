const express = require('express');
const { query } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const walletModel = require('../models/walletModel');
const userModel = require('../models/userModel');
const { ensureProofTable } = require('../utils/botTables');
const { ensureAgentTables } = require('../utils/agentTables');
const { generateCode, hashCode } = require('../utils/agents');
const { normalizeEthioPhone } = require('../utils/validators');
const { notifyReviewResult } = require('../utils/balanceNotify');

// ============================================================================
// 1) Agent management - ADMIN ONLY:  /api/admin/agents
// ============================================================================
const admin = express.Router();
admin.use(requireAuth, requireAdmin);

const publicAgent = (r) => ({
  id: r.id,
  userId5d: r.user_id_5d,
  username: r.username,
  active: r.active,
  telebirrName: r.telebirr_name || '',
  telebirrPhone: r.telebirr_phone || '',
  cbeName: r.cbe_name || '',
  cbeNumber: r.cbe_number || '',
  createdAt: r.created_at,
});

// the permission is granted / taken back with the Player ID AND the @username (both must belong to the same player)
const normUsername = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();
const sameUsername = (user, typed) => Boolean(normUsername(typed)) && normUsername(user.username) === normUsername(typed);

const SELECT_AGENT = `SELECT a.*, u.user_id_5d, u.username FROM agents a JOIN users u ON u.id = a.user_id`;

async function audit(actorId, action, targetId, metadata = {}) {
  await query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata) VALUES ($1, $2, 'agent', $3, $4)`,
    [actorId, action, targetId, JSON.stringify(metadata)]
  );
}

admin.get('/', async (req, res) => {
  await ensureAgentTables();
  const r = await query(`${SELECT_AGENT} ORDER BY a.id`);
  res.json(r.rows.map(publicAgent));
});

// give a player the agent permission. The access code is returned ONCE - only its hash is stored.
admin.post('/', async (req, res) => {
  await ensureAgentTables();
  const playerId = String(req.body.playerId || '').trim();
  if (!/^[0-9]{5}$/.test(playerId)) return res.status(400).json({ error: 'Player ID 5 ቁጥር መሆን አለበት (ለምሳሌ 00005)።' });
  const user = await userModel.findByUserId5d(playerId);
  if (!user) return res.status(404).json({ error: `Player ID ${playerId} አልተገኘም።` });
  if (!sameUsername(user, req.body.username)) return res.status(400).json({ error: 'Player ID እና Username አይዛመዱም። ሁለቱንም በትክክል ያስገቡ።' });
  if (user.status !== 'ACTIVE') return res.status(400).json({ error: 'ይህ አካውንት ንቁ አይደለም።' });
  if (user.is_admin) return res.status(400).json({ error: 'ይህ ሰው አስቀድሞ Admin ነው።' });
  const exists = await query('SELECT 1 FROM agents WHERE user_id = $1', [user.id]);
  if (exists.rowCount) return res.status(409).json({ error: 'ይህ ተጫዋች አስቀድሞ Agent ነው።' });

  const code = generateCode();
  const { salt, hash } = hashCode(code);
  const ins = await query('INSERT INTO agents (user_id, code_salt, code_hash) VALUES ($1, $2, $3) RETURNING id', [user.id, salt, hash]);
  await audit(req.user.id, 'AGENT_ADDED', ins.rows[0].id, { playerId });
  const row = (await query(`${SELECT_AGENT} WHERE a.id = $1`, [ins.rows[0].id])).rows[0];
  res.status(201).json({ agent: publicAgent(row), code });
});

// accounts players may pay to + on/off switch
admin.put('/:id', async (req, res) => {
  await ensureAgentTables();
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const b = req.body || {};

  let telebirrPhone = null;
  if (String(b.telebirrPhone || '').trim()) {
    telebirrPhone = normalizeEthioPhone(b.telebirrPhone);
    if (!telebirrPhone) return res.status(400).json({ error: 'የ Telebirr ስልክ ቁጥር ትክክል አይደለም (09XXXXXXXX)።' });
  }
  const cbeNumber = String(b.cbeNumber || '').replace(/\s+/g, '');
  if (cbeNumber && !/^[0-9]{6,20}$/.test(cbeNumber)) return res.status(400).json({ error: 'CBE account number must be 6-20 digits' });

  const r = await query(
    `UPDATE agents SET active = $2, telebirr_name = $3, telebirr_phone = $4, cbe_name = $5, cbe_number = $6, updated_at = now()
     WHERE id = $1 RETURNING id`,
    [id, b.active !== false, String(b.telebirrName || '').trim().slice(0, 80) || null, telebirrPhone, String(b.cbeName || '').trim().slice(0, 80) || null, cbeNumber || null]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'Agent not found' });
  await audit(req.user.id, 'AGENT_UPDATED', id, { active: b.active !== false });
  const row = (await query(`${SELECT_AGENT} WHERE a.id = $1`, [id])).rows[0];
  res.json(publicAgent(row));
});

admin.post('/:id/reset-code', async (req, res) => {
  await ensureAgentTables();
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const code = generateCode();
  const { salt, hash } = hashCode(code);
  const r = await query('UPDATE agents SET code_salt = $2, code_hash = $3, updated_at = now() WHERE id = $1 RETURNING id', [id, salt, hash]);
  if (!r.rowCount) return res.status(404).json({ error: 'Agent not found' });
  await audit(req.user.id, 'AGENT_CODE_RESET', id);
  res.json({ code });
});

// take the permission back using Player ID + username (same as the per-agent Remove button)
admin.post('/revoke', async (req, res) => {
  await ensureAgentTables();
  const playerId = String(req.body.playerId || '').trim();
  if (!/^[0-9]{5}$/.test(playerId)) return res.status(400).json({ error: 'Player ID 5 ቁጥር መሆን አለበት (ለምሳሌ 00005)።' });
  const user = await userModel.findByUserId5d(playerId);
  if (!user || !sameUsername(user, req.body.username)) return res.status(400).json({ error: 'Player ID እና Username አይዛመዱም።' });
  const r = await query('DELETE FROM agents WHERE user_id = $1 RETURNING id', [user.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'ይህ ተጫዋች Agent አይደለም።' });
  await audit(req.user.id, 'AGENT_REMOVED', r.rows[0].id, { playerId });
  res.json({ ok: true });
});

admin.delete('/:id', async (req, res) => {
  await ensureAgentTables();
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const r = await query('DELETE FROM agents WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Agent not found' });
  await audit(req.user.id, 'AGENT_REMOVED', id);
  res.json({ ok: true });
});

// ============================================================================
// 2) Deposit / withdrawal handling - ADMIN or ACTIVE AGENT:  /api/agent
//    An agent sees and reviews only: deposits sent to HIS account + all withdrawals,
//    and can never review his own request. Nothing else in the system is reachable.
// ============================================================================
const staff = express.Router();
staff.use(requireAuth);

async function requireStaff(req, res, next) {
  try {
    if (req.user.is_admin) {
      req.staff = { role: 'admin', agentId: null };
      return next();
    }
    await ensureAgentTables();
    const r = await query('SELECT id FROM agents WHERE user_id = $1 AND active = TRUE', [req.user.id]);
    if (!r.rowCount) return res.status(403).json({ error: 'Agent access required' });
    req.staff = { role: 'agent', agentId: r.rows[0].id };
    return next();
  } catch (err) {
    console.error('[agent] auth', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
staff.use(requireStaff);

staff.get('/me', (req, res) => {
  res.json({ role: req.staff.role, userId5d: req.user.user_id_5d, username: req.user.username });
});

/** Admin, active agent, or null - for any user row (used by the panel AND by the Telegram approve/reject buttons). */
async function staffOf(user) {
  if (!user || user.status !== 'ACTIVE') return null;
  if (user.is_admin) return { role: 'admin', agentId: null };
  await ensureAgentTables();
  const r = await query('SELECT id FROM agents WHERE user_id = $1 AND active = TRUE', [user.id]);
  return r.rowCount ? { role: 'agent', agentId: r.rows[0].id } : null;
}

/** May this staff member see / review this transaction? (deposit/withdrawal only - nothing else) */
async function canHandleTx(staff, user, txId) {
  const t = await query('SELECT id, user_id, type FROM transactions WHERE id = $1', [txId]);
  if (!t.rowCount) return { ok: false, status: 404, error: 'Transaction not found' };
  const tx = t.rows[0];
  if (!['VIRTUAL_DEPOSIT', 'VIRTUAL_WITHDRAWAL'].includes(tx.type)) return { ok: false, status: 403, error: 'Not allowed' };
  if (staff.role === 'admin') return { ok: true, tx };
  if (String(tx.user_id) === String(user.id)) return { ok: false, status: 403, error: 'የራስዎን ጥያቄ ማጽደቅ አይችሉም።' };
  if (tx.type === 'VIRTUAL_DEPOSIT') {
    const r = await query('SELECT 1 FROM deposit_routing WHERE transaction_id = $1 AND agent_id = $2', [txId, staff.agentId]);
    if (!r.rowCount) return { ok: false, status: 403, error: 'ይህ Deposit ወደ እርስዎ አካውንት የተላከ አይደለም።' };
  }
  return { ok: true, tx };
}
const canHandle = (req, txId) => canHandleTx(req.staff, req.user, txId);

staff.get('/transactions', async (req, res) => {
  await Promise.all([ensureProofTable(), ensureAgentTables()]);
  const { status } = req.query;
  const params = [];
  let sql = `SELECT t.id, t.user_id, t.type, t.amount, t.status, t.sender_phone, t.payment_reference, t.reference_note, t.created_at,
                    u.user_id_5d, u.username,
                    dr.method AS pay_method,
                    EXISTS (SELECT 1 FROM deposit_proofs dp WHERE dp.transaction_id = t.id) AS has_proof
               FROM transactions t JOIN users u ON u.id = t.user_id
               LEFT JOIN deposit_routing dr ON dr.transaction_id = t.id
              WHERE t.type IN ('VIRTUAL_DEPOSIT', 'VIRTUAL_WITHDRAWAL')`;
  if (status) {
    params.push(status);
    sql += ` AND t.status = $${params.length}`;
  }
  if (req.staff.role === 'agent') {
    params.push(req.staff.agentId, req.user.id);
    sql += ` AND t.user_id <> $${params.length}
             AND (t.type = 'VIRTUAL_WITHDRAWAL' OR dr.agent_id = $${params.length - 1})`;
  }
  sql += ' ORDER BY t.created_at DESC LIMIT 200';
  const r = await query(sql, params);
  res.json(r.rows);
});

staff.get('/transactions/:id/proof', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const ok = await canHandle(req, id);
  if (!ok.ok) return res.status(ok.status).json({ error: ok.error });
  await ensureProofTable();
  const r = await query('SELECT mime, data FROM deposit_proofs WHERE transaction_id = $1', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'No screenshot' });
  res.set('Content-Type', r.rows[0].mime);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(r.rows[0].data);
});

staff.post('/transactions/:id/review', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const { decision } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'Invalid decision' });
  const ok = await canHandle(req, id);
  if (!ok.ok) return res.status(ok.status).json({ error: ok.error });
  try {
    const tx = await walletModel.reviewTransaction(id, req.user.id, decision);
    notifyReviewResult(tx, tx.notices || []); // tell the player (fire-and-forget)
    res.json(tx);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = { admin, staff, staffOf, canHandleTx };
