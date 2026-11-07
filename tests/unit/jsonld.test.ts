import { describe, it, expect } from 'vitest';
import * as ld from '@/lib/public/jsonld';
import { parsePage, PAGE_SIZE } from '@/lib/public/paging';
import { escapeJsonLd } from '@/lib/seo';
import type { PublicItem } from '@/lib/items/repo';

const item = (title: string, over: Partial<PublicItem> = {}): PublicItem => ({
  id: 'i', world: 'discover', kind: 'article', slug: 'a-slug', title, summary: 'A summary that is long enough.', body: {},
  audience: 'all', evergreen: false, publishedAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-03T09:00:00Z'),
  sources: [], image: null, topics: [], ...over,
});
const BASE = 'https://sparkkindly.com';
const ORG = { '@type': 'Organization', name: 'SparkKindly', url: 'https://sparkkindly.com/', logo: 'https://sparkkindly.com/brand/icon-512.png' };

describe('articleLd', () => {
  it('cannot close the script element, even for a hostile title', () => {
    const json = escapeJsonLd(ld.articleLd(item('</script><script>alert(1)</script>'), 'https://sparkkindly.com'));
    expect(json).not.toContain('</script>');
    expect(json).not.toContain('<');
    expect(JSON.parse(json).headline).toBe('</script><script>alert(1)</script>');
  });

  it('points at the item URL; images are the template card, after the hero image (absolute) when there is one', () => {
    const d = ld.articleLd(item('T'), BASE) as Record<string, unknown>;
    expect(d['@type']).toBe('Article');
    expect(d.mainEntityOfPage).toBe('https://sparkkindly.com/discover/a-slug/');
    expect(d.image).toEqual(['https://sparkkindly.com/api/template-image/discover/a-slug/']);
    const hero = ld.articleLd(item('T', { image: { src: '/images/hero.webp', alt: '' } }), BASE) as Record<string, unknown>;
    expect(hero.image).toEqual(['https://sparkkindly.com/images/hero.webp', 'https://sparkkindly.com/api/template-image/discover/a-slug/']);
    const remote = ld.articleLd(item('T', { image: { src: 'https://cdn.example/x.jpg', alt: '' } }), BASE) as Record<string, unknown>;
    expect((remote.image as string[])[0]).toBe('https://cdn.example/x.jpg');
  });

  it('SEO audit M2: dateModified from updatedAt; publisher is the Organization with its logo', () => {
    const d = ld.articleLd(item('T'), BASE) as Record<string, unknown>;
    expect(d.datePublished).toBe('2026-10-01T00:00:00.000Z');
    expect(d.dateModified).toBe('2026-10-03T09:00:00.000Z');
    expect(d.publisher).toEqual(ORG);
  });

  it('SEO audit M2: author is the credited contributor, else the SparkKindly Organization with its url', () => {
    const own = ld.articleLd(item('T'), BASE) as Record<string, unknown>;
    expect(own.author).toEqual({ '@type': 'Organization', name: 'SparkKindly', url: 'https://sparkkindly.com/' });
    const credited = ld.articleLd(item('T'), BASE, { name: 'Robin Writes', slug: 'abcdefghij' }) as Record<string, unknown>;
    expect(credited.author).toEqual({ '@type': 'Person', name: 'Robin Writes', url: 'https://sparkkindly.com/contributors/abcdefghij/' });
  });

  it('exports nothing that could describe a quiz or an answer', () => {
    for (const name of Object.keys(ld)) expect(name).not.toMatch(/quiz|question|answer/i);
  });
});

describe('websiteLd and organizationLd (SEO audit M1)', () => {
  it('WebSite has the name and url', () => {
    expect(ld.websiteLd(BASE)).toEqual({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'SparkKindly', url: 'https://sparkkindly.com/' });
  });

  it('Organization has name, url and logo, and sameAs only for the social links that are set', () => {
    expect(ld.organizationLd(BASE, { youtube: null, instagram: null })).toEqual({ '@context': 'https://schema.org', ...ORG });
    const withSocial = ld.organizationLd(BASE, { youtube: 'https://youtube.example/@sk', instagram: null }) as Record<string, unknown>;
    expect(withSocial.sameAs).toEqual(['https://youtube.example/@sk']);
  });

  it('is valid JSON once escaped', () => {
    expect(JSON.parse(escapeJsonLd(ld.organizationLd(BASE, {})))['@type']).toBe('Organization');
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
