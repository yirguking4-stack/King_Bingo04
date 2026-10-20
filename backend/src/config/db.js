const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon closes idle connections: drop ours before that and keep the rest alive
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
});

pool.on('error', (err) => {
  // Neon drops idle connections; the pool opens a new one on the next query, so do NOT kill the server
  console.error('[db] Unexpected error on idle client (ignored):', err.message);
});

/**
 * Run a query with automatic client release.
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log('[db] query', { text, duration, rows: res.rowCount });
  }
  return res;
}

/**
 * Get a client for a manual transaction (BEGIN/COMMIT/ROLLBACK).
 */
async function getClient() {
  const client = await pool.connect();
  return client;
}

/**
 * Run a callback inside a DB transaction. Automatically
 * commits on success and rolls back on any thrown error.
 */
async function withTransaction(callback) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, getClient, withTransaction };
