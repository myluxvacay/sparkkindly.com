// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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

// The real migrations, applied one at a time: every constraint a migration from 026 on replaces in place
// (DROP CONSTRAINT x_check, ADD CONSTRAINT x_check CHECK ...) was a CHECK before and is a CHECK after, and where both
// definitions are a column = ANY (ARRAY[...]) list the new list keeps every old value (it only widens).
describe('constraints replaced by the real migrations (026 and later)', () => {
  const real = 'db/migrations';
  const all = readdirSync(real).filter((f) => /^\d{3}_\w+\.sql$/.test(f)).sort();
  const replaced = (f: string) =>
    [...readFileSync(path.join(real, f), 'utf8').replace(/--.*$/gm, '').matchAll(/\bDROP\s+CONSTRAINT\s+(\w+)\s*,\s*ADD\s+CONSTRAINT\s+\1\s+CHECK\b/gi)].map((m) => m[1]);
  const inList = (def: string) => {
    const m = /^CHECK \(\(\(?(\w+)\)?(?:::text)? = ANY \(\(?ARRAY\[(.*)\]\)?(?:::text\[\])?\)\)\)$/.exec(def);
    return m ? { column: m[1], values: [...m[2].matchAll(/'([^']*)'/g)].map((v) => v[1]) } : null;
  };

  it('are CHECKs before and after, and an IN-list only gains values', async () => {
    const db = fromPglite(pg);
    const def = async (name: string) =>
      (await db.query<{ contype: string; def: string }>('SELECT contype, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1', [name])).rows[0];
    let checked = 0;
    let lists = 0;
    expect(inList("CHECK ((role = ANY (ARRAY['content'::text, 'moderation'::text])))")).toEqual({ column: 'role', values: ['content', 'moderation'] });
    for (const f of all) {
      const names = Number(f.slice(0, 3)) >= 26 ? replaced(f) : [];
      const before = await Promise.all(names.map(def));
      writeFileSync(path.join(dir, f), readFileSync(path.join(real, f), 'utf8'));
      await migrate(db, dir);
      for (const [i, name] of names.entries()) {
        const after = await def(name);
        expect(before[i]?.contype, `${f}: ${name} before`).toBe('c');
        expect(after?.contype, `${f}: ${name} after`).toBe('c');
        const [o, n] = [inList(before[i].def), inList(after.def)];
        if (o && n) {
          expect(n.column, `${f}: ${name}`).toBe(o.column);
          expect(n.values, `${f}: ${name} narrows`).toEqual(expect.arrayContaining(o.values));
          lists++;
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2); // 026 and 028 widen agents_role_check
    expect(lists).toBe(checked); // every replacement so far is an IN-list, so every one was verified as a widening
  });
});
