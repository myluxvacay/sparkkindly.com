import { Pool } from 'pg';

let pool: Pool | undefined;

// One small shared pool for the process. Created lazily so importing this module never connects.
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 3000,
      statement_timeout: 3000,
      idleTimeoutMillis: 30_000,
    });
    // An idle client errors when PostgreSQL restarts (routine updates do this). With no listener, Node treats
    // that 'error' event as fatal and the whole web process dies; log it and let the pool reconnect instead.
    pool.on('error', (err) => console.error('database pool: idle client error:', err.message));
  }
  return pool;
}
