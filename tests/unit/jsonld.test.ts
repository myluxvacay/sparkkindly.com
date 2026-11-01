import { describe, it, expect } from 'vitest';
import * as ld from '@/lib/public/jsonld';
import { parsePage, PAGE_SIZE } from '@/lib/public/paging';
import { escapeJsonLd } from '@/lib/seo';
import type { PublicItem } from '@/lib/items/repo';

const item = (title: string): PublicItem => ({
  id: 'i', world: 'discover', kind: 'article', slug: 'a-slug', title, summary: 'A summary that is long enough.', body: {},
  audience: 'all', evergreen: false, publishedAt: new Date('2026-10-01T00:00:00Z'), sources: [], image: null, topics: [],
});

describe('articleLd', () => {
  it('cannot close the script element, even for a hostile title', () => {
    const json = escapeJsonLd(ld.articleLd(item('</script><script>alert(1)</script>'), 'https://sparkkindly.com'));
    expect(json).not.toContain('</script>');
    expect(json).not.toContain('<');
    expect(JSON.parse(json).headline).toBe('</script><script>alert(1)</script>');
  });

  it('points at the item URL and the template image', () => {
    const d = ld.articleLd(item('T'), 'https://sparkkindly.com') as Record<string, unknown>;
    expect(d['@type']).toBe('Article');
    expect(d.mainEntityOfPage).toBe('https://sparkkindly.com/discover/a-slug/');
    expect(d.image).toBe('https://sparkkindly.com/api/template-image/discover/a-slug/');
  });

  it('exports nothing that could describe a quiz or an answer', () => {
    for (const name of Object.keys(ld)) expect(name).not.toMatch(/quiz|question|answer/i);
  });
});

describe('breadcrumbLd', () => {
  it('lists home, world and the item with absolute URLs', () => {
    const d = ld.breadcrumbLd('https://sparkkindly.com', [{ name: 'Home', path: '/' }, { name: 'Discover', path: '/discover/' }]) as {
      itemListElement: { position: number; item: string }[];
    };
    expect(d.itemListElement.map((e) => e.item)).toEqual(['https://sparkkindly.com/', 'https://sparkkindly.com/discover/']);
    expect(d.itemListElement.map((e) => e.position)).toEqual([1, 2]);
  });
});

describe('parsePage', () => {
  it.each([[undefined, 1], ['1', 1], ['3', 3], ['0', 1], ['-1', 1], ['abc', 1], ['2.5', 1], ['', 1], ['999999999999', 1000]])(
    '%j gives page %i',
    (raw, page) => expect(parsePage(raw)).toBe(page),
  );
  it('uses twelve per page', () => expect(PAGE_SIZE).toBe(12));
});
