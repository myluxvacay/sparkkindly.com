import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const dir = 'db/migrations';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const REPLACED_CHECK = /\bDROP\s+CONSTRAINT\s+(\w+_check)\s*,\s*ADD\s+CONSTRAINT\s+\1\s+CHECK\b/gi;

describe('migration files', () => {
  it('are named NNN_snake_case.sql with consecutive numbers starting at 000', () => {
    files.forEach((f, i) => {
      expect(f, f).toMatch(/^\d{3}_[a-z0-9_]+\.sql$/);
      expect(Number(f.slice(0, 3)), f).toBe(i);
    });
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('never drop a table or column (expand-then-contract): only a file named *contract* may', () => {
    for (const f of files.filter((name) => !name.includes('contract'))) {
      const sql = readFileSync(path.join(dir, f), 'utf8').replace(/--.*$/gm, '');
      expect(sql, f).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
      // Replacing a CHECK in one statement (DROP CONSTRAINT x_check, ADD CONSTRAINT x_check CHECK ...) drops no data;
      // anything else does. The name must end in _check (a unique, primary or foreign key never does); that it really is
      // a CHECK and only widens is verified on the database in migrate.test.ts.
      const rest = sql.replace(REPLACED_CHECK, '');
      expect(rest, f).not.toMatch(/\bALTER\s+TABLE\b[^;]*\bDROP\b/i);
    }
  });

  it('a replaced CHECK is still recognised as a drop when it is not re-added in the same statement', () => {
    const strip = (sql: string) => sql.replace(REPLACED_CHECK, '');
    expect(strip('ALTER TABLE t DROP CONSTRAINT c_check;')).toMatch(/\bALTER\s+TABLE\b[^;]*\bDROP\b/i);
    expect(strip('ALTER TABLE t DROP CONSTRAINT c_check, ADD CONSTRAINT d_check CHECK (x);')).toMatch(/\bALTER\s+TABLE\b[^;]*\bDROP\b/i);
    expect(strip('ALTER TABLE t DROP CONSTRAINT c_check, ADD CONSTRAINT c_check CHECK (x);')).not.toMatch(/\bALTER\s+TABLE\b[^;]*\bDROP\b/i);
    // A name that does not end in _check (a key, a foreign key) is never excused, even when re-added as a CHECK.
    expect(strip('ALTER TABLE t DROP CONSTRAINT t_pkey, ADD CONSTRAINT t_pkey CHECK (true);')).toMatch(/\bALTER\s+TABLE\b[^;]*\bDROP\b/i);
    expect(strip('ALTER TABLE t DROP CONSTRAINT t_a_fkey, ADD CONSTRAINT t_a_fkey CHECK (x);')).toMatch(/\bALTER\s+TABLE\b[^;]*\bDROP\b/i);
  });

  it('have no leftover transaction control, because the runner wraps the whole run in one transaction', () => {
    for (const f of files) {
      // Function bodies between $$ markers legitimately contain BEGIN; only top-level statements count.
      const sql = readFileSync(path.join(dir, f), 'utf8').replace(/--.*$/gm, '').replace(/\$\$[\s\S]*?\$\$/g, '');
      expect(sql, f).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\b/im);
    }
  });
});

describe('deploy wiring', () => {
  it('deploy/migrate.sh runs the bundled migration runner with the bundled Node', () => {
    expect(existsSync('deploy/migrate.sh')).toBe(true);
    const sh = readFileSync('deploy/migrate.sh', 'utf8');
    expect(sh.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(sh).toContain('set -euo pipefail');
    expect(sh).toMatch(/exec \/opt\/sparkkindly\/node\/bin\/node db\/migrate\.mjs/);
    expect(sh).not.toContain('\r');
  });

  it('the deploy workflow ships db/ and migrate.sh in every release and makes the script executable', () => {
    const yml = readFileSync('.github/workflows/deploy.yml', 'utf8');
    expect(yml).toMatch(/cp -r db release\/db/);
    expect(yml).toMatch(/cp deploy\/migrate\.sh release\/migrate\.sh/);
    expect(yml).toMatch(/chmod \+x release\/migrate\.sh/);
  });

  it('the receiver runs a release migrate.sh before switching and keeps the old release when it fails', () => {
    const rx = readFileSync('deploy/bin/deploy-receive.sh', 'utf8');
    const migrateAt = rx.indexOf('./migrate.sh');
    const switchAt = rx.indexOf('ln -sfn "$NEW" "$ROOT/current.tmp"');
    expect(migrateAt).toBeGreaterThan(0);
    expect(migrateAt).toBeLessThan(switchAt);
    expect(rx).toMatch(/Migration failed; the previous release is still serving/);
  });

  it('db/migrate.mjs needs nothing outside Node and pg, so a release can run it without tsx', () => {
    const src = readFileSync('db/migrate.mjs', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const imports = [...src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const i of imports) expect(['node:fs', 'node:path', 'node:url', 'pg'], i).toContain(i);
  });
});
