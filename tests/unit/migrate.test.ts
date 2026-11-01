// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../db/migrate.mjs';
import { fromPglite } from '../helpers/test-db';

let dir: string;
let pg: PGlite;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'migrations-'));
  pg = new PGlite();
});
afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
  await pg.close();
});

const write = (name: string, sql: string) => writeFileSync(path.join(dir, name), sql);

describe('migrate', () => {
  it('applies pending migrations in filename order', async () => {
    write('002_second.sql', 'CREATE TABLE second (id int);');
    write('001_first.sql', 'CREATE TABLE first (id int);');
    const result = await migrate(fromPglite(pg), dir);
    expect(result.applied).toEqual(['001_first.sql', '002_second.sql']);
  });

  it('a second run applies nothing', async () => {
    write('001_first.sql', 'CREATE TABLE first (id int);');
    const db = fromPglite(pg);
    await migrate(db, dir);
    expect((await migrate(db, dir)).applied).toEqual([]);
  });

  it('a failing migration rolls back and is not recorded', async () => {
    write('001_ok.sql', 'CREATE TABLE ok (id int);');
    write('002_bad.sql', 'CREATE TABLE a (id int); SELECT 1/0;');
    const db = fromPglite(pg);
    await expect(migrate(db, dir)).rejects.toThrow();
    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
    );
    expect(tables.rows.map((r) => r.table_name)).not.toContain('a');
    const recorded = await db.query<{ name: string }>('SELECT name FROM schema_migrations').catch(() => ({ rows: [] }));
    expect(recorded.rows.map((r) => r.name)).not.toContain('002_bad.sql');
  });

  it('two concurrent runners apply each migration exactly once', async () => {
    write('001_log.sql', 'CREATE TABLE run_log (id serial primary key); INSERT INTO run_log DEFAULT VALUES;');
    const db = fromPglite(pg);
    await Promise.all([migrate(db, dir), migrate(db, dir)]);
    const rows = await db.query('SELECT * FROM run_log');
    expect(rows.rows).toHaveLength(1);
  });

  it('ignores files that do not match NNN_name.sql', async () => {
    write('001_first.sql', 'CREATE TABLE first (id int);');
    write('notes.txt', 'not a migration');
    write('README.sql', 'DROP TABLE nothing;');
    expect((await migrate(fromPglite(pg), dir)).applied).toEqual(['001_first.sql']);
  });
});
