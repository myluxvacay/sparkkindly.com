import { describe, expect, it } from 'vitest';
import { buildSitemap, flagPages, SITEMAP_MAX_ITEMS } from '@/lib/public/sitemap';

const base = 'https://example.test';
const at = new Date('2026-10-30T00:00:00Z');

describe('buildSitemap', () => {
  const map = buildSitemap([{ world: 'play', slug: 'a-quiz', updatedAt: at }], ['play', 'kids'], base, ['owls']);
  const urls = map.map((m) => m.url);

  it('lists static pages, worlds, topics and items with trailing slashes', () => {
    expect(urls).toEqual(expect.arrayContaining([
      `${base}/`, `${base}/quiz/archive/`, `${base}/about/`, `${base}/privacy/`, `${base}/terms/`,
      `${base}/play/`, `${base}/kids/`, `${base}/topics/`, `${base}/topics/owls/`, `${base}/play/a-quiz/`,
    ]));
    expect(urls.every((u) => u.endsWith('/'))).toBe(true);
  });

  it('gives items their last-modified date and does not filter what it was given', () => {
    expect(map.find((m) => m.url === `${base}/play/a-quiz/`)?.lastModified).toEqual(at);
    expect(buildSitemap([{ world: 'x', slug: 'y', updatedAt: at }], [], base).map((m) => m.url)).toContain(`${base}/x/y/`);
  });

  it('does not list /quiz/, whose canonical points at the quiz page itself', () => {
    expect(urls).not.toContain(`${base}/quiz/`);
    expect(urls).toContain(`${base}/quiz/archive/`);
  });

  it('never lists the search page', () => {
    expect(urls.some((u) => u.includes('/search'))).toBe(false);
  });
});

describe('flag pages (SEO audit L5)', () => {
  it('lists the guidelines, sponsorship and contributor terms pages only when their flags are on', () => {
    expect(flagPages({ comments: false, sponsorship: false, contributors: false })).toEqual([]);
    expect(flagPages({ comments: true, sponsorship: true, contributors: true })).toEqual(['/community/guidelines/', '/sponsorship/', '/contributors/terms/']);
    expect(flagPages({ comments: false, sponsorship: true, contributors: false })).toEqual(['/sponsorship/']);
  });

  it('buildSitemap adds the flag pages it is given', () => {
    const urls = buildSitemap([], [], base, [], ['/sponsorship/']).map((m) => m.url);
    expect(urls).toContain(`${base}/sponsorship/`);
    expect(urls).not.toContain(`${base}/community/guidelines/`);
  });
});

describe('size (SEO audit M4)', () => {
  it('one sitemap file stays under the 50,000-URL limit even at the item cap', () => {
    expect(SITEMAP_MAX_ITEMS).toBe(45_000);
    const items = Array.from({ length: SITEMAP_MAX_ITEMS }, (_, i) => ({ world: 'play', slug: `i-${i}`, updatedAt: at }));
    const topics = Array.from({ length: 500 }, (_, i) => `t-${i}`);
    expect(buildSitemap(items, Array.from({ length: 20 }, (_, i) => `w-${i}`), base, topics, flagPages({ comments: true, sponsorship: true, contributors: true })).length).toBeLessThan(50_000);
  });
});
