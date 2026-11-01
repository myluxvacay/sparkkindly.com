import { describe, expect, it } from 'vitest';
import { buildSitemap } from '@/lib/public/sitemap';

const base = 'https://example.test';
const at = new Date('2026-10-30T00:00:00Z');

describe('buildSitemap', () => {
  const map = buildSitemap([{ world: 'play', slug: 'a-quiz', updatedAt: at }], ['play', 'kids'], base, ['owls']);
  const urls = map.map((m) => m.url);

  it('lists static pages, worlds, topics and items with trailing slashes', () => {
    expect(urls).toEqual(expect.arrayContaining([
      `${base}/`, `${base}/quiz/`, `${base}/quiz/archive/`, `${base}/about/`, `${base}/privacy/`,
      `${base}/play/`, `${base}/kids/`, `${base}/topics/owls/`, `${base}/play/a-quiz/`,
    ]));
    expect(urls.every((u) => u.endsWith('/'))).toBe(true);
  });

  it('gives items their last-modified date and does not filter what it was given', () => {
    expect(map.find((m) => m.url === `${base}/play/a-quiz/`)?.lastModified).toEqual(at);
    expect(buildSitemap([{ world: 'x', slug: 'y', updatedAt: at }], [], base).map((m) => m.url)).toContain(`${base}/x/y/`);
  });

  it('never lists the search page', () => {
    expect(urls.some((u) => u.includes('/search'))).toBe(false);
  });
});
