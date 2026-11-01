import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Db, Queryable } from '@/lib/db';
import { migrate } from '../../db/migrate.mjs';

type Row = Record<string, unknown>;

function wrap(target: Pick<PGlite, 'query' | 'exec'> | Transaction): Queryable {
  return {
    async query<T = Row>(text: string, params?: unknown[]) {
      const r = await target.query<T>(text, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? null };
    },
    async exec(sql: string) {
      await target.exec(sql);
    },
  };
}

// An in-process PostgreSQL (PGlite) behind the same Db interface the app uses, so tests need no database server.
export function fromPglite(pg: PGlite): Db {
  return {
    ...wrap(pg),
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) => pg.transaction((tx) => fn(wrap(tx))),
  };
}

// A fresh, fully migrated database for one test file or test.
export async function newTestDb(): Promise<Db & { close(): Promise<void> }> {
  const pg = new PGlite();
  const db = fromPglite(pg);
  await migrate(db, 'db/migrations');
  return Object.assign(db, { close: () => pg.close() });
}
