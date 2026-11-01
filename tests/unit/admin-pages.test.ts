import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Every admin page outside sign-in must check the session itself: a layout check alone does not guard a page.
function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return pages(p);
    return name === 'page.tsx' ? [p] : [];
  });
}

describe('admin pages', () => {
  const all = pages('app/admin');
  const guarded = all.filter((p) => !p.split(path.sep).includes('sign-in'));

  it('exist', () => {
    expect(guarded.length).toBeGreaterThanOrEqual(8);
  });

  it.each(guarded)('%s calls requireAdmin() before anything else', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/import \{[^}]*requireAdmin[^}]*\} from '@\/lib\/admin\/next'/);
    expect(src).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*const \w+ = await requireAdmin\(\);/);
  });

  it('every admin POST target is a sign-in route or /admin/act/', () => {
    const routes = readdirSync('app/admin', { recursive: true }).map(String).filter((f) => f.endsWith('route.ts'));
    expect(routes.map((r) => r.split(path.sep).join('/')).sort()).toEqual([
      'act/route.ts',
      'sign-in/code/submit/route.ts',
      'sign-in/link/confirm/route.ts',
      'sign-in/request/route.ts',
    ]);
  });
});
