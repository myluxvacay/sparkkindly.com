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

  // A hard-coded audience list containing 'adults' (say `audiences: ['kids', 'all', 'adults']`) would bypass the session
  // scope just as anonymousScope( does. The only allowed literal is the admin new-item form's audience choice (admin
  // routes check the allow-list and second factor; it labels an option and reads nothing).
  const ADULTS_ALLOWED = new Set(['app/admin/items/new/page.tsx']);
  it("no file under app/ or components/ spells the 'adults' audience except the admin item form", () => {
    const offenders = ['app', 'components']
      .flatMap((d) => files(path.join(ROOT, d)))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((rel) => !ADULTS_ALLOWED.has(rel))
      .filter((rel) => /(['"`])adults\1/.test(readFileSync(path.join(ROOT, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
