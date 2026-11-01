import { Pool, type PoolClient } from 'pg';

type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  // Multi-statement SQL with no parameters (migrations). PGlite's query() runs one statement only.
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  // Runs fn on one connection inside BEGIN/COMMIT, rolling back if fn throws. Inside fn, use the tx you are
  // given, not the outer Db, or the work leaves the transaction (and can deadlock on a small pool).
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

let pool: Pool | undefined;

// One small shared pool for the process. Created lazily so importing this module never connects.
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
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

function wrapClient(client: Pick<Pool | PoolClient, 'query'>): Queryable {
  return {
    async query<T = Row>(text: string, params?: unknown[]) {
      const r = await client.query(text, params);
      return { rows: r.rows as T[], rowCount: r.rowCount };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  };
}

export function getDb(): Db {
  const p = getPool();
  return {
    ...wrapClient(p),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await p.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrapClient(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
