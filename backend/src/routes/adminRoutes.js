const express = require('express');
const { query } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const walletModel = require('../models/walletModel');
const { ensureProofTable, ensureCbeTable } = require('../utils/botTables');
const { ensureAgentTables } = require('../utils/agentTables');
const { notifyReviewResult, notifyAdminAdjust } = require('../utils/balanceNotify');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// ---- Dashboard ----
router.get('/dashboard', async (req, res) => {
  const [users, pendingTx, roomsToday, creditsInCirculation] = await Promise.all([
    query('SELECT COUNT(*) FROM users'),
    query(`SELECT COUNT(*) FROM transactions WHERE status = 'PENDING'`),
    query(`SELECT COUNT(*) FROM game_rooms WHERE created_at >= CURRENT_DATE`),
    query('SELECT COALESCE(SUM(balance),0) AS total FROM wallets'),
  ]);

  res.json({
    totalUsers: Number(users.rows[0].count),
    pendingTransactions: Number(pendingTx.rows[0].count),
    roomsToday: Number(roomsToday.rows[0].count),
    totalVirtualCreditsInCirculation: Number(creditsInCirculation.rows[0].total),
  });
});

// ---- Users ----
router.get('/users', async (req, res) => {
  const { search } = req.query;
  let sql = `SELECT u.id, u.user_id_5d, u.referred_by, u.username, u.telegram_id, u.status, u.created_at, w.balance, w.locked_balance
             FROM users u JOIN wallets w ON w.user_id = u.id`;
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    sql += ` WHERE u.username ILIKE $1 OR u.user_id_5d = $2`;
    params.push(search);
  }
  sql += ' ORDER BY u.created_at DESC LIMIT 200';
  const result = await query(sql, params);
  res.json(result.rows);
});

router.patch('/users/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['ACTIVE', 'SUSPENDED', 'BANNED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const target = await query('SELECT id, is_admin FROM users WHERE id = $1', [req.params.id]);
  if (target.rowCount === 0) return res.status(404).json({ error: 'User not found' });
  if (target.rows[0].is_admin && status !== 'ACTIVE') {
    return res.status(400).json({ error: 'Admin account cannot be suspended or banned' });
  }
  const result = await query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [
    req.params.id,
    status,
  ]);
  await query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, 'USER_STATUS_CHANGED', 'user', $2, $3)`,
    [req.user.id, req.params.id, JSON.stringify({ newStatus: status })]
  );
  res.json(result.rows[0]);
});

// Admin manual credit/debit adjustment (e.g. promotional grant, correction)
router.post('/users/:id/adjust-balance', async (req, res) => {
  const { amount, direction, reason } = req.body; // direction: 'CREDIT' | 'DEBIT'
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Amount must be positive' });
  if (!['CREDIT', 'DEBIT'].includes(direction)) return res.status(400).json({ error: 'Invalid direction' });

  const { withTransaction } = require('../config/db');
  let result;
  try {
  result = await withTransaction(async (client) => {
    const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [req.params.id]);
    if (walletRes.rowCount === 0) throw new Error('Wallet not found');
    const wallet = walletRes.rows[0];

    const delta = direction === 'CREDIT' ? amt : -amt;
    const newBalance = Number(wallet.balance) + delta;
    if (newBalance < 0) throw new Error('Resulting balance would be negative');

    await client.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE user_id = $1', [
      req.params.id,
      newBalance,
    ]);

    const tx = await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status, reference_note, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, 'COMPLETED', $6, $7, now()) RETURNING *`,
      [
        req.params.id,
        direction === 'CREDIT' ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        amt,
        wallet.balance,
        newBalance,
        reason || null,
        req.user.id,
      ]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, 'user', $3, $4)`,
      [req.user.id, `BALANCE_${direction}`, req.params.id, JSON.stringify({ amount: amt, reason })]
    );

    return tx.rows[0];
  });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  notifyAdminAdjust({ userId: req.params.id, direction, amount: amt, reason }); // tell the player (fire-and-forget)
  res.json(result);
});

// ---- Transactions (deposit/withdrawal approval workflow) ----
router.get('/transactions', async (req, res) => {
  const { status, type } = req.query;
  await Promise.all([ensureProofTable(), ensureAgentTables()]);
  let sql = `SELECT t.*, u.user_id_5d, u.username,
                    dr.method AS pay_method, au.username AS pay_agent_username,
                    EXISTS (SELECT 1 FROM deposit_proofs dp WHERE dp.transaction_id = t.id) AS has_proof
               FROM transactions t JOIN users u ON u.id = t.user_id
               LEFT JOIN deposit_routing dr ON dr.transaction_id = t.id
               LEFT JOIN agents ag ON ag.id = dr.agent_id
               LEFT JOIN users au ON au.id = ag.user_id
              WHERE 1=1`;
  const params = [];
  if (status) {
    params.push(status);
    sql += ` AND t.status = $${params.length}`;
  }
  if (type) {
    params.push(type);
    sql += ` AND t.type = $${params.length}`;
  }
  sql += ' ORDER BY t.created_at DESC LIMIT 200';
  const result = await query(sql, params);
  res.json(result.rows);
});

// the screenshot a player attached to a deposit request
router.get('/transactions/:id/proof', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  await ensureProofTable();
  const r = await query('SELECT mime, data FROM deposit_proofs WHERE transaction_id = $1', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'No screenshot' });
  res.set('Content-Type', r.rows[0].mime);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(r.rows[0].data);
});

router.post('/transactions/:id/review', async (req, res) => {
  const { decision } = req.body; // 'APPROVED' | 'REJECTED'
  try {
    const tx = await walletModel.reviewTransaction(req.params.id, req.user.id, decision);
    notifyReviewResult(tx, tx.notices || []); // tell the player (fire-and-forget)
    res.json(tx);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Game rooms ----
router.get('/rooms', async (req, res) => {
  const result = await query(
    `SELECT gr.*, st.entry_credits, st.commission_percent,
            (SELECT COUNT(*) FROM game_entries ge WHERE ge.game_room_id = gr.id) AS player_count
     FROM game_rooms gr JOIN stake_tiers st ON st.id = gr.stake_tier_id
     ORDER BY gr.created_at DESC LIMIT 100`
  );
  res.json(result.rows);
});

// ---- Audit logs ----
router.get('/audit-logs', async (req, res) => {
  const result = await query(
    `SELECT al.*, u.user_id_5d AS actor_user_id_5d, u.username AS actor_username
     FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_user_id
     ORDER BY al.created_at DESC LIMIT 300`
  );
  res.json(result.rows);
});

// ---- Settings (Telebirr display info, editable by admin) ----
router.get('/settings', async (req, res) => {
  const result = await query('SELECT key, value FROM admin_settings');
  res.json(result.rows);
});

router.put('/settings/:key', async (req, res) => {
  const { value } = req.body;
  const result = await query(
    `INSERT INTO admin_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now() RETURNING *`,
    [req.params.key, value]
  );
  res.json(result.rows[0]);
});

// ---- CBE accounts (shown on the players' Deposit page for copying) ----
function cleanCbe(body) {
  const accountName = String(body.accountName || '').trim().slice(0, 80);
  const accountNumber = String(body.accountNumber || '').replace(/\s+/g, '');
  if (!accountName) return { error: 'Account name is required' };
  if (!/^[0-9]{6,20}$/.test(accountNumber)) return { error: 'Account number must be 6-20 digits' };
  return { accountName, accountNumber };
}

router.get('/cbe-accounts', async (req, res) => {
  await ensureCbeTable();
  const r = await query('SELECT id, account_name, account_number FROM cbe_accounts ORDER BY sort_order, id');
  res.json(r.rows.map((x) => ({ id: x.id, accountName: x.account_name, accountNumber: x.account_number })));
});

router.post('/cbe-accounts', async (req, res) => {
  await ensureCbeTable();
  const c = cleanCbe(req.body);
  if (c.error) return res.status(400).json({ error: c.error });
  const r = await query(
    `INSERT INTO cbe_accounts (account_name, account_number, sort_order)
     VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) + 1 FROM cbe_accounts), 0)) RETURNING id, account_name, account_number`,
    [c.accountName, c.accountNumber]
  );
  await query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata) VALUES ($1, 'CBE_ACCOUNT_ADDED', 'cbe_account', $2, $3)`,
    [req.user.id, r.rows[0].id, JSON.stringify({ accountName: c.accountName })]
  );
  res.status(201).json({ id: r.rows[0].id, accountName: r.rows[0].account_name, accountNumber: r.rows[0].account_number });
});

router.put('/cbe-accounts/:id', async (req, res) => {
  await ensureCbeTable();
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const c = cleanCbe(req.body);
  if (c.error) return res.status(400).json({ error: c.error });
  const r = await query(
    `UPDATE cbe_accounts SET account_name = $2, account_number = $3, updated_at = now()
     WHERE id = $1 RETURNING id, account_name, account_number`,
    [id, c.accountName, c.accountNumber]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'Account not found' });
  await query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata) VALUES ($1, 'CBE_ACCOUNT_UPDATED', 'cbe_account', $2, $3)`,
    [req.user.id, id, JSON.stringify({ accountName: c.accountName })]
  );
  res.json({ id: r.rows[0].id, accountName: r.rows[0].account_name, accountNumber: r.rows[0].account_number });
});

router.delete('/cbe-accounts/:id', async (req, res) => {
  await ensureCbeTable();
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const r = await query('DELETE FROM cbe_accounts WHERE id = $1 RETURNING id', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Account not found' });
  await query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id) VALUES ($1, 'CBE_ACCOUNT_DELETED', 'cbe_account', $2)`,
    [req.user.id, id]
  );
  res.json({ ok: true });
});

module.exports = router;
