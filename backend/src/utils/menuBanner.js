'use strict';
// The picture shown above the bot's pinned menu. Admins can replace it from the admin panel;
// it is stored in the database (Render's disk is wiped on every deploy). No row = the bot uses
// its built-in bot/assets/menu-banner.jpg.
const { query } = require('../config/db');

let ready = null;
function ensureMenuBannerTable() {
  if (!ready) {
    ready = query(`CREATE TABLE IF NOT EXISTS menu_banner (
      id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      mime        VARCHAR(20) NOT NULL,
      data        BYTEA NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

function detectMime(buf) {
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

async function getBanner() {
  await ensureMenuBannerTable();
  const r = await query('SELECT mime, data, updated_at FROM menu_banner WHERE id = 1');
  return r.rowCount ? r.rows[0] : null;
}

module.exports = { ensureMenuBannerTable, detectMime, getBanner };
