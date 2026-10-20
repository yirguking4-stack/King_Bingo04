const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const walletModel = require('../models/walletModel');
const { normalizeSenderAccount, normalizeTxId } = require('../utils/validators');
const { notifyAdmins, depositAlertText, withdrawalAlertText } = require('../utils/notifier');
const { ensureProofTable, ensureCbeTable } = require('../utils/botTables');
const { ensureAgentTables } = require('../utils/agentTables');
const { paymentMethods } = require('../utils/agents');
const { normalizeEthioPhone } = require('../utils/validators');
const crypto = require('crypto');

const MAX_PROOF_BYTES = 700 * 1024;

/** Validates a base64 data-URL image and returns { mime, data, sha256 } (or null if invalid). */
function parseScreenshot(raw) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(raw || ''));
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  if (data.length < 1000 || data.length > MAX_PROOF_BYTES) return null;
  const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const isPng = data.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isWebp = data.slice(0, 4).toString() === 'RIFF' && data.slice(8, 12).toString() === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) return null;
  return { mime: m[1], data, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}

const router = express.Router();

const MIN_DEPOSIT = 25.0;
const MAX_DEPOSIT = 10000.0;
const MIN_WITHDRAWAL = 50.0;
const MAX_WITHDRAWAL = 10000.0;

/**
 * GET /api/wallet/telebirr-info
 * Returns the admin's Telebirr account name/number for display + copy only.
 * The backend never initiates, tracks, or automates a transfer against
 * this account — it is informational, matching the "available for copy"
 * requirement.
 */
router.get('/telebirr-info', requireAuth, async (req, res) => {
  const result = await query(`SELECT key, value FROM admin_settings WHERE key IN ('telebirr_account_name', 'telebirr_account_phone')`);
  const info = {};
  for (const row of result.rows) info[row.key] = row.value;
  res.json({
    accountName: info.telebirr_account_name,
    accountPhone: info.telebirr_account_phone,
    note: 'Send ETB top-up arrangements only as instructed by the admin, then submit your reference note below. This does not automatically add ETB to your wallet — an admin reviews every request.',
  });
});

/**
 * GET /api/wallet/payment-info
 * Everything the Deposit page shows for copying: the Telebirr account plus the
 * CBE accounts the admin manages in the admin panel (Settings).
 */
router.get('/payment-info', requireAuth, async (req, res) => {
  await ensureCbeTable();
  const [tele, cbe] = await Promise.all([
    query(`SELECT key, value FROM admin_settings WHERE key IN ('telebirr_account_name', 'telebirr_account_phone')`),
    query('SELECT id, account_name, account_number FROM cbe_accounts ORDER BY sort_order, id'),
  ]);
  const info = {};
  for (const row of tele.rows) info[row.key] = row.value;
  // methods: every account a player may pay to, per method (admin's and agents'). Agents are not named.
  const m = await paymentMethods().catch((err) => {
    console.error('[wallet] payment methods:', err.message);
    return { TELEBIRR: [], CBE: [] };
  });
  const strip = (list) => list.map((a) => ({ ref: a.ref, accountName: a.name, accountNumber: a.number }));
  res.json({
    telebirr: { accountName: info.telebirr_account_name, accountPhone: info.telebirr_account_phone },
    cbeAccounts: cbe.rows.map((r) => ({ id: r.id, accountName: r.account_name, accountNumber: r.account_number })),
    methods: { TELEBIRR: strip(m.TELEBIRR), CBE: strip(m.CBE) },
  });
});

router.post('/deposit-request', requireAuth, async (req, res) => {
  const amt = Number(req.body.amount);

  if (!amt || amt < MIN_DEPOSIT || amt > MAX_DEPOSIT) {
    return res.status(400).json({ error: `Amount must be between ${MIN_DEPOSIT} and ${MAX_DEPOSIT} ETB` });
  }

  // the player first chooses Telebirr or CBE; the sender number must then match that method
  const method = ['TELEBIRR', 'CBE'].includes(req.body.method) ? req.body.method : null;
  let senderPhone;
  if (method === 'TELEBIRR') {
    senderPhone = normalizeEthioPhone(req.body.senderPhone);
    if (!senderPhone) return res.status(400).json({ error: 'የ Telebirr ስልክ ቁጥር ትክክል አይደለም (ለምሳሌ 09XXXXXXXX)።' });
  } else if (method === 'CBE') {
    const v = String(req.body.senderPhone || '').replace(/[\s-]/g, '');
    senderPhone = /^1000[0-9*]{6,12}$/.test(v) ? v : null;
    if (!senderPhone) return res.status(400).json({ error: 'የ CBE account ቁጥር ትክክል አይደለም (ለምሳሌ 1000XXXXXXXXX)።' });
  } else {
    senderPhone = normalizeSenderAccount(req.body.senderPhone);
    if (!senderPhone) {
      return res.status(400).json({ error: 'የ Telebirr ስልክ ቁጥር ወይም የ CBE account ቁጥር ትክክል አይደለም (ለምሳሌ 09XXXXXXXX ወይም 1000XXXXXXXXX)።' });
    }
  }

  // which account did the player pay to? (admin's or an agent's) -> decides who is alerted and may approve
  let payTo = null;
  if (method) {
    const options = (await paymentMethods())[method];
    if (options.length) {
      const picked = req.body.payTo ? options.find((o) => o.ref === String(req.body.payTo)) : options.length === 1 ? options[0] : null;
      if (!picked) return res.status(400).json({ error: 'እባክዎ ገንዘቡን የላኩበትን አካውንት ይምረጡ።' });
      payTo = { method, agentId: picked.agentId, name: picked.name, number: picked.number };
    }
  }
  // proof of payment: a Transaction ID, a screenshot, or both
  const hasTxInput = String(req.body.transactionId ?? '').trim() !== '';
  const paymentReference = hasTxInput ? normalizeTxId(req.body.transactionId) : null;
  if (hasTxInput && !paymentReference) {
    return res.status(400).json({ error: 'Transaction ID ትክክል አይደለም (6-30 ፊደል ወይም ቁጥር፣ ያለ ክፍተት)።' });
  }

  let proof = null;
  if (req.body.screenshot) {
    proof = parseScreenshot(req.body.screenshot);
    if (!proof) {
      return res.status(400).json({ error: 'Screenshot ትክክል አይደለም (JPG/PNG፣ ከ700KB በታች)። እንደገና ይሞክሩ።' });
    }
  }
  if (!paymentReference && !proof) {
    return res.status(400).json({ error: 'Transaction ID ወይም Screenshot ያስገቡ።' });
  }

  let tx;
  try {
    if (proof) {
      await ensureProofTable();
      const dup = await query('SELECT 1 FROM deposit_proofs WHERE sha256 = $1', [proof.sha256]);
      if (dup.rowCount > 0) {
        return res.status(409).json({ error: 'ይህ Screenshot አስቀድሞ ገብቷል። አዲስ Screenshot ያያይዙ።' });
      }
    }
    if (payTo) await ensureAgentTables();
    tx = await walletModel.requestVirtualDeposit(req.user.id, amt, { senderPhone, paymentReference, proof, routing: payTo ? { agentId: payTo.agentId, method: payTo.method } : null });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'ይህ Transaction ID ወይም Screenshot አስቀድሞ ገብቷል። ትክክለኛውን ያረጋግጡ።' });
    }
    throw err;
  }

  // alert every admin in Telegram (fire-and-forget: never delays or fails the request)
  notifyAdmins(
    depositAlertText({ user: req.user, amount: amt, senderPhone, transactionId: paymentReference, hasScreenshot: Boolean(proof), payTo }),
    'DEPOSIT',
    { txId: tx.id, agentIds: payTo && payTo.agentId ? [payTo.agentId] : [] } // the owner of the account he paid to (admins always get it)
  );

  res.status(201).json({ message: 'Deposit request submitted. Awaiting admin approval.', transaction: tx });
});

router.post('/withdrawal-request', requireAuth, async (req, res) => {
  const { amount, note } = req.body;
  const amt = Number(amount);

  if (!amt || amt < MIN_WITHDRAWAL || amt > MAX_WITHDRAWAL) {
    return res.status(400).json({ error: `Amount must be between ${MIN_WITHDRAWAL} and ${MAX_WITHDRAWAL} ETB` });
  }

  try {
    const tx = await walletModel.requestVirtualWithdrawal(req.user.id, amt, note);
    notifyAdmins(withdrawalAlertText({ user: req.user, amount: amt, note }), 'WITHDRAWAL', { txId: tx.id, agentIds: 'ALL' });
    res.status(201).json({ message: 'Withdrawal request submitted. Awaiting admin approval.', transaction: tx });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') return res.status(400).json({ error: err.message });
    throw err;
  }
});

module.exports = router;
