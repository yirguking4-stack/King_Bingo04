const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { ensureAppointmentTables } = require('../utils/botTables');
const { maskName } = require('../utils/maskName');
const { notifyNewAppointment } = require('../utils/appointmentNotify');

const router = express.Router();
router.use(requireAuth);

const MAX_LENGTH = 30; // characters
const DAILY_LIMIT = 3; // suggestions per player per day
const VISIBLE_HOURS = 48; // older suggestions are hidden automatically

router.use(async (req, res, next) => {
  try {
    await ensureAppointmentTables();
    next();
  } catch (err) {
    next(err);
  }
});

// everyone sees every suggestion: most "agree" votes first, then newest
router.get('/', async (req, res) => {
  const rows = await query(
    `SELECT a.id, a.body, a.created_at, u.username, u.user_id_5d, a.user_id,
            (SELECT COUNT(*) FROM appointment_votes v WHERE v.appointment_id = a.id) AS votes,
            EXISTS (SELECT 1 FROM appointment_votes v WHERE v.appointment_id = a.id AND v.user_id = $1) AS voted
       FROM appointments a
       JOIN users u ON u.id = a.user_id
      WHERE a.created_at > now() - ($2 || ' hours')::interval
      ORDER BY votes DESC, a.created_at DESC
      LIMIT 100`,
    [req.user.id, String(VISIBLE_HOURS)]
  );
  res.json({
    maxLength: MAX_LENGTH,
    items: rows.rows.map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      username: maskName(r.username || `player${r.user_id_5d}`),
      votes: Number(r.votes),
      voted: r.voted,
      mine: r.user_id === req.user.id,
    })),
  });
});

router.post('/', async (req, res) => {
  const body = String(req.body?.body ?? '').replace(/\s+/g, ' ').trim();
  const length = [...body].length;
  if (length === 0) return res.status(400).json({ error: 'ቀጠሮ ይጻፉ።' });
  if (length > MAX_LENGTH) return res.status(400).json({ error: `ቀጠሮው ከ${MAX_LENGTH} ፊደል መብለጥ የለበትም።` });

  const today = await query(
    `SELECT COUNT(*) AS c FROM appointments WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
    [req.user.id]
  );
  if (Number(today.rows[0].c) >= DAILY_LIMIT) {
    return res.status(429).json({ error: `በቀን ከ${DAILY_LIMIT} ቀጠሮ በላይ ማቅረብ አይቻልም።` });
  }

  const inserted = await query('INSERT INTO appointments (user_id, body) VALUES ($1, $2) RETURNING id', [req.user.id, body]);
  res.status(201).json({ id: inserted.rows[0].id });

  // tell everyone (in the background, after the reply is sent)
  notifyNewAppointment({ authorUserId: req.user.id, body, authorName: req.user.username });
});

// each player can switch the "new ቀጠሮ" notifications off/on
router.get('/prefs', async (req, res) => {
  const r = await query('SELECT appointments FROM notification_prefs WHERE user_id = $1', [req.user.id]);
  res.json({ notify: r.rowCount === 0 ? true : r.rows[0].appointments });
});

router.post('/prefs', async (req, res) => {
  const notify = req.body?.notify !== false;
  await query(
    `INSERT INTO notification_prefs (user_id, appointments) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET appointments = EXCLUDED.appointments`,
    [req.user.id, notify]
  );
  res.json({ notify });
});

// tap = "👍 እስማማለሁ", tap again = take it back
router.post('/:id/vote', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const exists = await query('SELECT 1 FROM appointments WHERE id = $1', [id]);
  if (exists.rowCount === 0) return res.status(404).json({ error: 'ቀጠሮው አልተገኘም።' });

  const removed = await query('DELETE FROM appointment_votes WHERE appointment_id = $1 AND user_id = $2', [id, req.user.id]);
  if (removed.rowCount === 0) {
    await query('INSERT INTO appointment_votes (appointment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.user.id]);
  }
  res.json({ voted: removed.rowCount === 0 });
});

// the author or an admin can delete
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const found = await query('SELECT user_id FROM appointments WHERE id = $1', [id]);
  if (found.rowCount === 0) return res.status(404).json({ error: 'ቀጠሮው አልተገኘም።' });
  if (found.rows[0].user_id !== req.user.id && req.user.is_admin !== true) {
    return res.status(403).json({ error: 'ይህን ማጥፋት አይችሉም።' });
  }
  await query('DELETE FROM appointments WHERE id = $1', [id]);
  res.json({ ok: true });
});

module.exports = router;
