import { describe, expect, it } from 'vitest';
import { buildInventory, checkEntry, type Entry } from '@/lib/cutover/inventory';

const articles = [{ brand: 'discover', slug: 'a-day-in-shadows' }];
const quizzes = [{ id: 'number-detective-001', brand: 'play' }];

describe('buildInventory', () => {
  const inv = buildInventory(articles, quizzes);
  const by = (path: string) => inv.find((e) => e.path === path);

  it('covers every URL the static mock-up served', () => {
    for (const p of ['/', '/play/', '/discover/', '/together/', '/grow/', '/kids/', '/quiz/', '/quiz/archive/', '/about/',
      '/editorial-policy/', '/privacy/', '/accessibility/', '/contact/', '/robots.txt', '/sitemap.xml', '/discover/a-day-in-shadows/']) {
      expect(by(p), p).toBeDefined();
    }
  });

  it('keeps item URLs unchanged and redirects old quiz ids to the item page', () => {
    expect(by('/discover/a-day-in-shadows/')?.status).toBe(200);
    expect(by('/quiz/number-detective-001/')).toMatchObject({ status: 308, location: '/play/number-detective-001/' });
  });

  it('adds the new trust page and has no duplicate paths', () => {
    expect(by('/terms/')?.status).toBe(200);
    expect(new Set(inv.map((e) => e.path)).size).toBe(inv.length);
  });
});

describe('checkEntry', () => {
  const ok: Entry = { path: '/a/', status: 200 };
  const redirect: Entry = { path: '/q/x/', status: 308, location: '/play/x/' };

  it('passes a matching response', () => {
    expect(checkEntry(ok, { status: 200, location: null })).toBeNull();
    expect(checkEntry(redirect, { status: 308, location: 'https://example.test/play/x/' })).toBeNull();
    expect(checkEntry(redirect, { status: 308, location: '/play/x/' })).toBeNull();
  });

  it('reports a wrong status or a wrong redirect target', () => {
    expect(checkEntry(ok, { status: 404, location: null })).toMatch(/expected 200, got 404/);
    expect(checkEntry(redirect, { status: 308, location: '/play/y/' })).toMatch(/redirect to \/play\/x\//);
    expect(checkEntry(redirect, { status: 200, location: null })).toMatch(/expected 308/);
  });
});
