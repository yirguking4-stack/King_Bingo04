const { query } = require('../config/db');

let ready = null;

/**
 * Agents = trusted players the admin allows to handle deposit/withdrawal requests ONLY
 * (see routes/agentRoutes.js). Idempotent and automatic (no manual SQL in Neon).
 *  - agents: one row per agent, with the Telebirr / CBE account players may pay to
 *    and a hashed personal access code for the admin-panel login
 *  - deposit_routing: which account (admin or which agent) a deposit was sent to,
 *    so the alert and the approval go to the owner of that account
 */
function ensureAgentTables() {
  if (!ready) {
    ready = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS agents (
          id             SERIAL PRIMARY KEY,
          user_id        BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          active         BOOLEAN NOT NULL DEFAULT TRUE,
          telebirr_name  VARCHAR(80),
          telebirr_phone VARCHAR(20),
          cbe_name       VARCHAR(80),
          cbe_number     VARCHAR(32),
          code_salt      TEXT NOT NULL,
          code_hash      TEXT NOT NULL,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await query(`
        CREATE TABLE IF NOT EXISTS deposit_routing (
          transaction_id BIGINT PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
          agent_id       INTEGER REFERENCES agents(id) ON DELETE SET NULL,
          method         VARCHAR(10) NOT NULL
        )`);
      await query('CREATE INDEX IF NOT EXISTS deposit_routing_agent_idx ON deposit_routing (agent_id)');
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

module.exports = { ensureAgentTables };
