const { query } = require('../config/db');

let ready = null;

/**
 * Creates the two small helper tables the bot features need. Idempotent and
 * automatic (no manual SQL in Neon): runs once per server start.
 */
function ensureBotTables() {
  if (!ready) {
    ready = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS bot_register_prompts (
          telegram_id BIGINT NOT NULL,
          message_id  BIGINT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (telegram_id, message_id)
        )`);
      await query(`
        CREATE TABLE IF NOT EXISTS admin_alerts (
          id                SERIAL PRIMARY KEY,
          admin_telegram_id BIGINT NOT NULL,
          message_id        BIGINT NOT NULL,
          kind              TEXT NOT NULL,
          body              TEXT NOT NULL,
          archived          BOOLEAN NOT NULL DEFAULT FALSE,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await query('CREATE INDEX IF NOT EXISTS admin_alerts_admin_idx ON admin_alerts (admin_telegram_id, archived, id DESC)');
    })().catch((err) => {
      ready = null; // retry next time
      throw err;
    });
  }
  return ready;
}

let apptReady = null;

/** "ቀጠሮ" suggestion box tables (idempotent, automatic). */
function ensureAppointmentTables() {
  if (!apptReady) {
    apptReady = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS appointments (
          id         SERIAL PRIMARY KEY,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          body       VARCHAR(30) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await query(`
        CREATE TABLE IF NOT EXISTS appointment_votes (
          appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
          user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY (appointment_id, user_id)
        )`);
      await query('CREATE INDEX IF NOT EXISTS appointments_created_idx ON appointments (created_at DESC)');
      await query(`
        CREATE TABLE IF NOT EXISTS notification_prefs (
          user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          appointments BOOLEAN NOT NULL DEFAULT TRUE
        )`);
    })().catch((err) => {
      apptReady = null;
      throw err;
    });
  }
  return apptReady;
}

let proofReady = null;

/** Deposit screenshot storage (idempotent, automatic). */
function ensureProofTable() {
  if (!proofReady) {
    proofReady = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS deposit_proofs (
          transaction_id BIGINT PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
          mime           TEXT NOT NULL,
          data           BYTEA NOT NULL,
          sha256         TEXT NOT NULL,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await query('CREATE UNIQUE INDEX IF NOT EXISTS deposit_proofs_sha_idx ON deposit_proofs (sha256)');
    })().catch((err) => {
      proofReady = null;
      throw err;
    });
  }
  return proofReady;
}

let cbeReady = null;

/** Admin-managed CBE accounts shown on the Deposit page (idempotent, automatic). */
function ensureCbeTable() {
  if (!cbeReady) {
    cbeReady = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS cbe_accounts (
          id             SERIAL PRIMARY KEY,
          account_name   VARCHAR(80) NOT NULL,
          account_number VARCHAR(32) NOT NULL,
          sort_order     INTEGER NOT NULL DEFAULT 0,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
    })().catch((err) => {
      cbeReady = null;
      throw err;
    });
  }
  return cbeReady;
}

module.exports = { ensureBotTables, ensureAppointmentTables, ensureProofTable, ensureCbeTable };
