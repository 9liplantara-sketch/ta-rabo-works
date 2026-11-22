/**
 * Neon interactive transaction (WebSocket Pool).
 * HTTP の sql.transaction は分岐付き更新に向かないため、日報×media 整合用。
 */
import { Pool } from '@neondatabase/serverless';

/**
 * @template T
 * @param {(client: import('@neondatabase/serverless').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withInteractiveTransaction(fn) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) { /* ignore */ }
    throw err;
  } finally {
    try {
      client.release();
    } catch (_) { /* ignore */ }
    try {
      await pool.end();
    } catch (_) { /* ignore */ }
  }
}
