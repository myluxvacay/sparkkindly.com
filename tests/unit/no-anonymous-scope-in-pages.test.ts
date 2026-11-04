// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Pages and routes must read through currentScope() so a signed-in child profile never gets `adults` items
// (.claude/rules/data-isolation.md). Only the sitemap, public indexing and never per person, stays anonymous.
const ALLOWED = new Set(['app/sitemap.ts']);
const ROOT = path.resolve(__dirname, '../..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('public pages use the session scope', () => {
  it('no file under app/ or components/ calls anonymousScope( except the sitemap', () => {
    const offenders = ['app', 'components']
      .flatMap((d) => files(path.join(ROOT, d)))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => readFileSync(path.join(ROOT, rel), 'utf8').includes('anonymousScope('));
    expect(offenders).toEqual([]);
  });
});
