// Topic hubs (26 Nov 2026): the matching rules are pinned exactly by synthetic fixtures (one
// per rule shape), the data module must stay consistent (78 topics, unique slugs, real intros,
// no collision with the curated topic namespace), the sitemap must list every hub URL exactly
// once, and a hub page's metadata must be its own title and canonical. Live-library assertions
// are growth-proof floors only — exact live counts are NOT pinned: the staging library lags
// main, and the daily content pipeline grows main's library every day, so an exact count
// pinned against the live library breaks deploys it has nothing to do with.
import { describe, expect, it } from 'vitest';
import {
  CLUSTERS, TOPICS, clusterBySlug, hubSitemapPaths, sitemapTopicSplit, topicBySlug, topicSearchText,
} from '@/lib/topics-hub/data';
import { groupItems, hubCounts, matchTopicItems, topicCount, type HubItem } from '@/lib/topics-hub/match';
import type { AgeBand } from '@/lib/age-bands';
import { anonymousScope, type Scope } from '@/lib/public/scope';
import { buildSitemap } from '@/lib/public/sitemap';
import { topicChildren, topicParents, topicRoots } from '@/db/seed/topics';
import { generateMetadata } from '@/app/topics/[slug]/page';

const scope = anonymousScope(new Date('2026-11-26T00:00:00Z'));
const count = (slug: string) => topicCount(topicBySlug(slug)!, scope);

// The audit's STRONG-match totals against the live library, recorded 26 Nov 2026
// (topic-hub-coverage-audit-2026-11-26.md; independently recomputed in the build review):
// counting-worksheets 175, money-worksheets-for-kids 51, kindness-activities 111,
// countries-of-the-world 195, how-things-work 142 (split 74 read / 45 printables /
// 23 quizzes / 0 games), how-the-body-works 45, free-printable-worksheets 346,
// educational-games-online 377, pre-k-learning-activities 789, farm-animals 18,
// mazes-for-kids 20, spot-the-difference-games 56. These numbers are the recorded baseline,
// NOT assertions: the library grows daily, so the rule shapes are pinned exactly against
// synthetic fixtures below and the live library is held only to growth-proof floors.

// A fixture item, adapted exactly as lib/topics-hub/match.ts adapts the real library: an
// article's headline is "title slug", a quiz's headline is its prompt, a game's is its title,
// an article tagged 'printables' is a printable, and the audience follows the brand.
type FixtureSpec = {
  id: string;
  kind: HubItem['rawKind'];
  brand?: string;
  title: string; // for a quiz, its prompt
  slug?: string; // articles only; quizzes and games use their id
  tags?: string[];
  gameType?: string;
  bands?: AgeBand[];
  day: number; // publishedAt day-of-month, keeps the newest-first sort deterministic
};

function fixtureItem(spec: FixtureSpec): HubItem {
  const brand = spec.brand ?? 'kids';
  const tags = spec.tags ?? [];
  const bands = spec.bands ?? [];
  const type: HubItem['type'] = spec.kind === 'article'
    ? (tags.includes('printables') ? 'printable' : 'article')
    : spec.kind;
  const headline = spec.kind === 'article' ? `${spec.title} ${spec.slug ?? spec.id}` : `${spec.title} `;
  const publishedAt = new Date(Date.UTC(2026, 0, spec.day));
  return {
    id: spec.id, rawKind: spec.kind, type, brand, title: spec.title, headline,
    tags, gameType: spec.gameType, bands,
    pub: {
      id: spec.id, world: brand, kind: spec.kind,
      slug: spec.kind === 'article' ? (spec.slug ?? spec.id) : spec.id,
      title: spec.title, summary: spec.title, body: null,
      audience: brand === 'kids' ? 'kids' : 'all', evergreen: false,
      publishedAt, updatedAt: publishedAt, sources: [], image: { origin: 'template' },
      topics: [], ageBands: [...bands],
    },
  };
}

const FIXTURES: HubItem[] = [
  fixtureItem({ id: 'a1', kind: 'article', title: 'Counting worksheets for preschool', slug: 'counting-worksheets-for-preschool', bands: ['3-5'], day: 1 }),
  fixtureItem({ id: 'a2', kind: 'article', title: 'All about volcanoes', slug: 'all-about-volcanoes', bands: ['6-8'], day: 2 }),
  fixtureItem({ id: 'q1', kind: 'quiz', title: 'How many wheels does a bus have?', bands: ['3-5'], day: 3 }),
  fixtureItem({ id: 'p1', kind: 'article', title: 'Autumn path puzzle', slug: 'autumn-path-puzzle', tags: ['printables', 'printables-mazes'], bands: ['3-5'], day: 4 }),
  fixtureItem({ id: 'p2', kind: 'article', title: 'Autumn path colouring page', slug: 'autumn-path-colouring', tags: ['printables'], bands: ['6-8'], day: 5 }),
  fixtureItem({ id: 'a3', kind: 'article', title: 'How a lever works', slug: 'how-a-lever-works', bands: ['6-8'], day: 6 }),
  fixtureItem({ id: 'a4', kind: 'article', title: 'How many legs does a spider have?', slug: 'how-many-legs-does-a-spider-have', bands: ['6-8'], day: 7 }),
  fixtureItem({ id: 'a5', kind: 'article', title: 'How much rain falls in a year?', slug: 'how-much-rain-falls-in-a-year', bands: ['9-12'], day: 8 }),
  fixtureItem({ id: 'a6', kind: 'article', title: 'How your ears turn vibrations into sound', slug: 'how-your-ears-turn-vibrations-into-sound', bands: ['6-8'], day: 9 }),
  fixtureItem({ id: 'a7', kind: 'article', title: 'How planet Earth moves', slug: 'how-planet-earth-moves', bands: ['6-8'], day: 10 }),
  fixtureItem({ id: 'a8', kind: 'article', title: 'How the heart pumps blood', slug: 'how-the-heart-pumps-blood', bands: ['6-8'], day: 11 }),
  fixtureItem({ id: 'a9', kind: 'article', title: 'The heart is a muscle', slug: 'the-heart-is-a-muscle', bands: ['6-8'], day: 12 }),
  fixtureItem({ id: 'a10', kind: 'article', title: 'Counting coins at the shop', slug: 'counting-coins-at-the-shop', bands: ['6-8'], day: 13 }),
  fixtureItem({ id: 'a11', kind: 'article', brand: 'save', title: 'Counting coins at the shop', slug: 'counting-coins-at-the-shop-save', bands: ['3-5'], day: 14 }),
  fixtureItem({ id: 'g1', kind: 'game', title: 'Memory match: animals', gameType: 'memory', bands: ['3-5'], day: 15 }),
  fixtureItem({ id: 'a12', kind: 'article', title: 'Memory match: animals', slug: 'memory-match-animals', bands: ['3-5'], day: 16 }),
  fixtureItem({ id: 'a13', kind: 'article', title: 'Gentle first words', slug: 'gentle-first-words', bands: ['3-5'], day: 17 }),
  fixtureItem({ id: 'a14', kind: 'article', title: 'Gentle first words for older children', slug: 'gentle-first-words-older', bands: ['9-12'], day: 18 }),
  fixtureItem({ id: 'a15', kind: 'article', brand: 'discover', title: 'Gentle first words', slug: 'gentle-first-words-discover', bands: ['3-5'], day: 19 }),
  fixtureItem({ id: 'q2', kind: 'quiz', title: 'How does a rainbow form?', bands: ['6-8'], day: 20 }),
  fixtureItem({ id: 'p3', kind: 'article', title: 'How a seed grows', slug: 'how-a-seed-grows', tags: ['printables'], bands: ['6-8'], day: 21 }),
];

const fixtureIds = (slug: string) =>
  matchTopicItems(topicBySlug(slug)!, scope, FIXTURES).map((i) => i.id).sort();

describe('topic hub matching: rule shapes (synthetic fixtures)', () => {
  it('matches plain headline phrases, with the quiz prompt as its headline', () => {
    // a4 is a "How many…" read: the counting phrases match its headline like any other.
    expect(fixtureIds('counting-worksheets')).toEqual(['a1', 'a10', 'a11', 'a4', 'q1']);
  });

  it('matches the mazes printables-mazes tag rule and nothing else', () => {
    expect(fixtureIds('mazes-for-kids')).toEqual(['p1']);
  });

  it('how-things-work takes How-titles but never How many / How much', () => {
    expect(fixtureIds('how-things-work')).toEqual(['a3', 'a6', 'a7', 'a8', 'p3', 'q2']);
    const groups = groupItems(matchTopicItems(topicBySlug('how-things-work')!, scope, FIXTURES));
    expect(groups.read.length).toBe(4);
    expect(groups.printables.length).toBe(1);
    expect(groups.quizzes.length).toBe(1);
    expect(groups.games.length).toBe(0);
  });

  it('how-the-body-works needs a body word with real boundaries — "Earth" is not "ear"', () => {
    // a6 matches on "ears", a8 on "heart"; a7's "Earth" must not trip the ear pattern,
    // and a9 names the heart without the How-title the rule also requires.
    expect(fixtureIds('how-the-body-works')).toEqual(['a6', 'a8']);
  });

  it('applies the brand filter (money worksheets are Kids-world only)', () => {
    expect(fixtureIds('money-worksheets-for-kids')).toEqual(['a10']);
  });

  it('gamesOnly takes games, not a read with the same title', () => {
    expect(fixtureIds('educational-games-online')).toEqual(['g1']);
  });

  it('applies the brand and age-band filters together (pre-k)', () => {
    expect(fixtureIds('pre-k-learning-activities')).toEqual(['a1', 'a12', 'a13', 'g1', 'p1', 'q1']);
  });

  it('hubCounts over a fixture source agrees with the per-topic matches', () => {
    const { perTopic } = hubCounts(scope, FIXTURES);
    for (const slug of ['counting-worksheets', 'mazes-for-kids', 'how-things-work',
      'how-the-body-works', 'money-worksheets-for-kids', 'educational-games-online',
      'pre-k-learning-activities']) {
      expect(perTopic.get(slug), slug).toBe(fixtureIds(slug).length);
      expect(topicCount(topicBySlug(slug)!, scope, FIXTURES), slug).toBe(fixtureIds(slug).length);
    }
  });
});

describe('topic hub matching: live library (growth-proof properties)', () => {
  // No absolute floors here: the audit's exact counts (Launch ≥ 12, the eight Borderline
  // topics 6–11) were measured against the production library at audit time; fidelity to
  // them is pinned by the synthetic fixtures above and the recorded baseline. A branch
  // can legitimately carry an older library snapshot — staging lags production by
  // design — so an absolute floor would test the snapshot, not the matcher (staging run
  // 45894998811: coding-for-kids-beginners counted 10 on staging's older library vs ≥12
  // on production's). What must hold on ANY library these pages ship against is that no
  // topic page is empty and the group splits stay consistent.
  it('every topic matches at least one item (no empty hub pages)', () => {
    for (const t of TOPICS) {
      expect(topicCount(t, scope), t.slug).toBeGreaterThanOrEqual(1);
    }
  });

  it('the how-things-work group split sums to its total', () => {
    const groups = groupItems(matchTopicItems(topicBySlug('how-things-work')!, scope));
    const split = groups.read.length + groups.printables.length + groups.games.length + groups.quizzes.length;
    expect(split).toBe(count('how-things-work'));
  });

  it('matches something across the library as a whole', () => {
    const { perTopic } = hubCounts(scope);
    expect([...perTopic.values()].reduce((n, c) => n + c, 0)).toBeGreaterThan(0);
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

describe('topic hub counts snapshot cache', () => {
  const noon = anonymousScope(new Date('2026-11-26T12:00:00Z'));
  // A scope on a day no snapshot is ever taken for: topicCount with it always takes the
  // direct per-topic scan, so it is the uncached truth the snapshot is checked against.
  const directAnon = anonymousScope(new Date('2026-11-25T12:00:00Z'));

  it('serves a repeated hubCounts call for the same audiences and day from the snapshot', () => {
    const first = hubCounts(noon);
    const again = hubCounts(anonymousScope(new Date('2026-11-26T18:30:00Z')));
    expect(again).toBe(first);
  });

  it('recomputes on a new day, with identical counts', () => {
    const today = hubCounts(noon);
    const tomorrow = hubCounts(anonymousScope(new Date('2026-11-27T00:00:01Z')));
    expect(tomorrow).not.toBe(today);
    expect([...tomorrow.perTopic.entries()]).toEqual([...today.perTopic.entries()]);
    expect([...tomorrow.perCluster.entries()]).toEqual([...today.perCluster.entries()]);
  });

  it('snapshot counts equal the direct per-topic counts for every topic and cluster', () => {
    const snap = hubCounts(noon);
    for (const t of TOPICS) expect(snap.perTopic.get(t.slug), t.slug).toBe(topicCount(t, directAnon));
    for (const c of CLUSTERS) {
      const sum = TOPICS.filter((t) => t.cluster === c.slug)
        .reduce((n, t) => n + (snap.perTopic.get(t.slug) ?? 0), 0);
      expect(snap.perCluster.get(c.slug), c.slug).toBe(sum);
    }
  });

  it('keys the snapshot by audience set: a child scope gets its own, audit-true counts', () => {
    const child: Scope = { audiences: ['kids', 'all'], now: new Date('2026-11-26T12:00:00Z') };
    const childDirect: Scope = { audiences: ['kids', 'all'], now: new Date('2026-11-25T12:00:00Z') };
    const snap = hubCounts(child);
    expect(snap).not.toBe(hubCounts(noon));
    for (const t of TOPICS) expect(snap.perTopic.get(t.slug), t.slug).toBe(topicCount(t, childDirect));
    // topicCount served from the child's own snapshot agrees with the snapshot itself.
    for (const t of TOPICS) expect(topicCount(t, child), t.slug).toBe(snap.perTopic.get(t.slug));
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
