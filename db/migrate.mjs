// Plain-ESM migration runner. It ships inside every release and runs with the bundled Node and `pg` only (no tsx).
// All pending migrations apply in ONE transaction under a transaction-level advisory lock, so a failure leaves
// nothing half-applied and two runners (two deploys, or a deploy and a hand run) cannot both apply a migration.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCK_KEY = 7263001;

/**
 * @param {import('../lib/db').Db} db
 * @param {string} dir directory of NNN_name.sql files
 * @returns {Promise<{ applied: string[] }>}
 */
export async function migrate(db, dir) {
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await tx.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set((await tx.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const applied = [];
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.exec(readFileSync(path.join(dir, file), 'utf8'));
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      applied.push(file);
    }
    return { applied };
  });
}

// CLI: `node db/migrate.mjs` migrates the database named by DATABASE_URL with the migrations beside this file.
async function main() {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const wrap = (c) => ({
    query: async (text, params) => {
      const r = await c.query(text, params);
      return { rows: r.rows, rowCount: r.rowCount };
    },
    exec: async (sql) => {
      await c.query(sql);
    },
  });
  const db = {
    ...wrap(pool),
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
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
  try {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
    const { applied } = await migrate(db, dir);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'No pending migrations');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}
