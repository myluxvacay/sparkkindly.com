// Topic hubs (26 Nov 2026): the matching layer must reproduce the coverage audit's STRONG
// counts against the live library, the data module must stay consistent (78 topics, unique
// slugs, real intros, no collision with the curated topic namespace), the sitemap must list
// every hub URL exactly once, and a hub page's metadata must be its own title and canonical.
import { describe, expect, it } from 'vitest';
import {
  CLUSTERS, TOPICS, clusterBySlug, hubSitemapPaths, sitemapTopicSplit, topicBySlug, topicSearchText,
} from '@/lib/topics-hub/data';
import { groupItems, matchTopicItems, topicCount } from '@/lib/topics-hub/match';
import { anonymousScope } from '@/lib/public/scope';
import { buildSitemap } from '@/lib/public/sitemap';
import { topicChildren, topicParents, topicRoots } from '@/db/seed/topics';
import { generateMetadata } from '@/app/topics/[slug]/page';

const scope = anonymousScope(new Date('2026-11-26T00:00:00Z'));
const count = (slug: string) => topicCount(topicBySlug(slug)!, scope);

describe('topic hub matching reproduces the audit counts', () => {
  // The audit's strong-match totals (topic-hub-coverage-audit-2026-11-26.md), one per rule
  // shape: plain headline phrases, brand-filtered, metadata-wide and tag-matched topics.
  it.each([
    ['counting-worksheets', 175],
    ['money-worksheets-for-kids', 51],
    ['kindness-activities', 111],
    ['countries-of-the-world', 195],
    ['how-things-work', 142],
    ['how-the-body-works', 45],
    ['free-printable-worksheets', 346],
    ['educational-games-online', 377],
    ['pre-k-learning-activities', 789],
    ['farm-animals', 18],
    ['mazes-for-kids', 20],
    ['spot-the-difference-games', 56],
  ])('%s matches %i items', (slug, expected) => {
    expect(count(slug)).toBe(expected);
  });

  it('groups how-things-work into its audit split by type', () => {
    const groups = groupItems(matchTopicItems(topicBySlug('how-things-work')!, scope));
    expect(groups.read.length).toBe(74);
    expect(groups.printables.length).toBe(45);
    expect(groups.quizzes.length).toBe(23);
    expect(groups.games.length).toBe(0);
  });
});

describe('topic hub data', () => {
  it('ships the approved scope: 70 launches + 8 borderlines, 13 clusters', () => {
    expect(TOPICS.length).toBe(78);
    expect(CLUSTERS.length).toBe(13);
    expect(TOPICS.every((t) => t.enabled)).toBe(true);
  });

  it('has unique slugs, valid clusters and a real intro per topic', () => {
    const slugs = TOPICS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const t of TOPICS) {
      expect(clusterBySlug(t.cluster), t.slug).toBeTruthy();
      expect(t.intro.length, t.slug).toBeGreaterThanOrEqual(80);
      expect(t.phrases.length > 0 || t.filter, t.slug).toBeTruthy();
    }
    expect(new Set(TOPICS.map((t) => t.intro)).size).toBe(TOPICS.length); // no shared boilerplate
  });

  it('never collides with the curated topic slugs it shares /topics/ with', () => {
    const curated = new Set([
      ...Object.keys(topicParents),
      ...Object.keys(topicRoots),
      ...Object.values(topicChildren).flatMap((kids) => Object.keys(kids)),
    ]);
    for (const t of TOPICS) expect(curated.has(t.slug), t.slug).toBe(false);
    for (const c of CLUSTERS) expect(curated.has(c.slug), c.slug).toBe(false);
  });

  it('excludes the flagged tell-the-time candidate', () => {
    expect(topicBySlug('telling-the-time')).toBeUndefined();
    expect(TOPICS.some((t) => /tell(ing)? the time/.test(t.title.toLowerCase()))).toBe(false);
  });

  it('makes topics findable by the words parents type', () => {
    const text = topicSearchText(topicBySlug('counting-worksheets')!, 'Numbers & Early Math');
    expect(text).toContain('counting');
    expect(text).toContain('numbers');
  });
});

describe('topic hub sitemap', () => {
  it('lists every hub URL exactly once, even against a colliding curated topic', () => {
    expect(hubSitemapPaths().length).toBe(91); // 13 clusters + 78 topics
    const split = sitemapTopicSplit(['science', 'owls', 'kindness-activities']);
    const urls = buildSitemap([], [], 'https://sparkkindly.com', split.topics, split.extra).map((e) => e.url);
    const occurrences = (path: string) => urls.filter((u) => u === `https://sparkkindly.com${path}`).length;
    expect(occurrences('/topics/')).toBe(1);
    expect(occurrences('/topics/countries-of-the-world/')).toBe(1);
    expect(occurrences('/topics/science-for-kids/')).toBe(1);
    expect(occurrences('/topics/kindness-activities/')).toBe(1); // hub wins the shared slug
    expect(occurrences('/topics/science/')).toBe(1); // unrelated curated topic untouched
    expect(occurrences('/topics/owls/')).toBe(1);
    for (const p of hubSitemapPaths()) expect(occurrences(p), p).toBe(1);
  });
});

describe('topic hub metadata', () => {
  const meta = (slug: string) =>
    generateMetadata({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });

  it('gives a topic page its own title, description and self-canonical', async () => {
    const m = await meta('countries-of-the-world');
    expect(m.title).toBe('Countries of the world');
    expect(m.alternates?.canonical).toBe('/topics/countries-of-the-world/');
    expect(String(m.description)).toContain('Country Facts');
  });

  it('gives a cluster hub its own title and canonical', async () => {
    const m = await meta('science-for-kids');
    expect(m.title).toBe('Science');
    expect(m.alternates?.canonical).toBe('/topics/science-for-kids/');
  });
});
