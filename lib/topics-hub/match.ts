// Topic-hub matching (26 Nov 2026): turns the content library (lib/content) into the items a
// topic page shows, using the audit's STRONG-match rules (see lib/topics-hub/data.ts). Matching
// runs at request time over the library exports, so an item published tomorrow joins every
// topic it matches with no code change; a topic page is only ever a data entry plus this file.
//
// The items are adapted to the PublicItem shape the existing cards render, mirroring the
// legacy import (lib/items/import-legacy.ts) field for field: a quiz's slug is its id and its
// title is derived from the id, a game's slug is its id and a memory game's summary is the
// fixed line, an article's image is its hero record, and every item's topics are its tags plus
// its age-band topics. Audience mirrors the import too (kids world = 'kids', else 'all'), and
// callers pass the viewer's scope so a signed-in child profile never receives an item its
// scope excludes — the same rule every other public read follows.
import { articles, games, quizzes } from '@/lib/content';
import { brands } from '@/lib/config';
import { bandTopicsFor, type AgeBand } from '@/lib/age-bands';
import type { PublicItem, Audience } from '@/lib/items/repo';
import type { World } from '@/lib/public/worlds';
import type { Scope } from '@/lib/public/scope';
import { CLUSTERS, TOPICS, topicBySlug, type TopicDef } from './data';

export type HubGroupKey = 'read' | 'printables' | 'games' | 'quizzes';
export const HUB_GROUPS: { key: HubGroupKey; label: string }[] = [
  { key: 'read', label: 'Read' },
  { key: 'printables', label: 'Printables' },
  { key: 'games', label: 'Games' },
  { key: 'quizzes', label: 'Quizzes' },
];

type RawKind = 'article' | 'quiz' | 'game';
type ItemType = 'article' | 'printable' | 'quiz' | 'game';

export type HubItem = {
  id: string;
  rawKind: RawKind;
  type: ItemType;
  brand: string;
  /** The headline the audit matched on: article title, quiz prompt, game title. */
  title: string;
  headline: string;
  tags: readonly string[];
  gameType?: string;
  bands: readonly AgeBand[];
  pub: PublicItem;
};

const audienceFor = (brand: string): Audience => (brand === 'kids' ? 'kids' : 'all');

// lib/items/import-legacy.ts imageFor, mirrored: the card image record for an article/quiz hero.
function imageFor(hero: { src: string; alt: string; width: number; height: number; credit: string; rights: string }) {
  const stock = /unsplash/i.test(hero.credit);
  return {
    src: hero.src, alt: hero.alt, width: hero.width, height: hero.height,
    origin: stock ? 'stock' : 'owner-supplied',
    licence: stock ? 'https://unsplash.com/license' : hero.rights,
    credit: hero.credit, rights: hero.rights,
  };
}

// lib/items/import-legacy.ts quizTitle, mirrored: "octopus-hearts-266" -> "Octopus hearts".
function quizTitle(id: string): string {
  const words = id.replace(/-\d+$/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MEMORY_GAME_SUMMARY = 'A memory picture game: look carefully, remember what you see, then answer from memory.';

function buildItems(): HubItem[] {
  const out: HubItem[] = [];
  for (const a of articles) {
    const type: ItemType = a.tags.includes('printables') ? 'printable' : 'article';
    out.push({
      id: a.id, rawKind: 'article', type, brand: a.brand, title: a.title,
      headline: `${a.title} ${a.slug}`, tags: a.tags, bands: a.ageBands ?? [],
      pub: {
        id: a.id, world: a.brand, kind: 'article', slug: a.slug, title: a.title, summary: a.description,
        body: null, audience: audienceFor(a.brand), evergreen: false,
        publishedAt: new Date(a.publishedAt ?? a.updatedAt), updatedAt: new Date(a.updatedAt),
        sources: a.sources, image: imageFor(a.hero),
        topics: [...a.tags, ...bandTopicsFor(a.ageBands)], ageBands: [...(a.ageBands ?? [])],
      },
    });
  }
  for (const q of quizzes) {
    out.push({
      id: q.id, rawKind: 'quiz', type: 'quiz', brand: q.brand, title: q.prompt,
      headline: `${q.prompt} `, tags: [], bands: q.ageBands ?? [],
      pub: {
        id: q.id, world: q.brand, kind: 'quiz', slug: q.id, title: quizTitle(q.id), summary: q.prompt,
        body: null, audience: audienceFor(q.brand), evergreen: false,
        publishedAt: new Date(q.scheduledDate), updatedAt: new Date(q.scheduledDate),
        sources: q.sources, image: q.hero ? imageFor(q.hero) : { origin: 'template' },
        topics: bandTopicsFor(q.ageBands), ageBands: [...(q.ageBands ?? [])],
      },
    });
  }
  for (const g of games) {
    out.push({
      id: g.id, rawKind: 'game', type: 'game', brand: g.brand, title: g.title,
      headline: `${g.title} `, tags: [], gameType: g.gameType, bands: g.ageBands ?? [],
      pub: {
        id: g.id, world: g.brand, kind: 'game', slug: g.id, title: g.title,
        summary: g.gameType === 'memory' ? MEMORY_GAME_SUMMARY : g.prompt,
        body: null, audience: audienceFor(g.brand), evergreen: false,
        publishedAt: new Date(g.scheduledDate), updatedAt: new Date(g.scheduledDate),
        sources: g.sources, image: { origin: 'template' },
        topics: bandTopicsFor(g.ageBands), ageBands: [...(g.ageBands ?? [])],
      },
    });
  }
  return out;
}

const ITEMS: HubItem[] = buildItems();

const rxCache = new Map<string, RegExp>();
const rx = (pattern: string): RegExp => {
  let r = rxCache.get(pattern);
  if (!r) {
    r = new RegExp(pattern, 'i');
    rxCache.set(pattern, r);
  }
  return r;
};

const titleHow = (title: string): boolean => {
  const t = title.trim().toLowerCase();
  return t.startsWith('how') && !t.startsWith('how many') && !t.startsWith('how much');
};

export function matchesTopic(item: HubItem, def: TopicDef): boolean {
  if (def.phrases.length > 0 && !def.phrases.some((p) => rx(p).test(item.headline))) return false;
  const f = def.filter;
  if (!f) return true;
  if (f.brands && !f.brands.includes(item.brand)) return false;
  if (f.printable && item.type !== 'printable') return false;
  if (f.gamesOnly && item.rawKind !== 'game') return false;
  if (f.tag && !item.tags.includes(f.tag)) return false;
  if (f.gameTypes && !(item.gameType !== undefined && f.gameTypes.includes(item.gameType))) return false;
  if (f.bandsAny && !item.bands.some((b) => f.bandsAny!.includes(b))) return false;
  if (f.titleHow && !titleHow(item.title)) return false;
  if (f.also && !f.also.some((p) => rx(p).test(item.headline))) return false;
  return true;
}

const byNewest = (a: HubItem, b: HubItem): number =>
  b.pub.publishedAt.getTime() - a.pub.publishedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The items a topic page shows this viewer: strong matches the viewer's scope allows, newest first. */
export function matchTopicItems(def: TopicDef, scope: Scope): HubItem[] {
  return ITEMS.filter((i) => scope.audiences.includes(i.pub.audience) && matchesTopic(i, def)).sort(byNewest);
}

function countTopicItems(def: TopicDef, scope: Scope): number {
  return ITEMS.reduce((n, i) => (scope.audiences.includes(i.pub.audience) && matchesTopic(i, def) ? n + 1 : n), 0);
}

export function topicCount(def: TopicDef, scope: Scope): number {
  // A cached hub-counts snapshot for this scope already holds this topic's count, computed by
  // the identical scan below — serve it from there when the def is the canonical topic entry.
  // The snapshot is only ever read here, never computed: a lone topic count stays a lone scan.
  const snap = peekHubCounts(scope);
  if (snap && topicBySlug(def.slug) === def) {
    const n = snap.perTopic.get(def.slug);
    if (n !== undefined) return n;
  }
  return countTopicItems(def, scope);
}

const GROUP_OF: Record<ItemType, HubGroupKey> = { article: 'read', printable: 'printables', game: 'games', quiz: 'quizzes' };

export function groupItems(items: HubItem[]): Record<HubGroupKey, PublicItem[]> {
  const groups: Record<HubGroupKey, PublicItem[]> = { read: [], printables: [], games: [], quizzes: [] };
  for (const i of items) groups[GROUP_OF[i.type]].push(i.pub);
  return groups;
}

export type HubCounts = { perTopic: Map<string, number>; perCluster: Map<string, number> };

// Hub-counts snapshot cache. A full hubCounts pass scans the library once per topic (78 scans),
// far too much to repeat on every master-hub request. The counts depend only on the library
// (which changes solely on deploy/import — a process restart, so a module-level snapshot can
// never outlive the content it counted) and on the viewer's scope. The cache key is therefore
// everything the counts actually depend on: the scope's audience set, plus the scope's date at
// day granularity — scopes are date-aware, so a snapshot is never served across a midnight
// boundary. One entry per audience set (the day's snapshot replaces yesterday's), so the cache
// stays a handful of small maps however long the process runs.
const countsCache = new Map<string, { day: string; counts: HubCounts }>();

function countsCacheKey(scope: Scope): { audiences: string; day: string } {
  return {
    audiences: [...scope.audiences].sort().join(','),
    day: scope.now.toISOString().slice(0, 10),
  };
}

/** The cached counts snapshot for this scope, if one exists — never computes one. */
function peekHubCounts(scope: Scope): HubCounts | undefined {
  const { audiences, day } = countsCacheKey(scope);
  const hit = countsCache.get(audiences);
  return hit && hit.day === day ? hit.counts : undefined;
}

function computeHubCounts(scope: Scope): HubCounts {
  const perTopic = new Map<string, number>();
  const perCluster = new Map<string, number>();
  for (const t of TOPICS) {
    const n = countTopicItems(t, scope);
    perTopic.set(t.slug, n);
    perCluster.set(t.cluster, (perCluster.get(t.cluster) ?? 0) + n);
  }
  for (const c of CLUSTERS) if (!perCluster.has(c.slug)) perCluster.set(c.slug, 0);
  return { perTopic, perCluster };
}

/** Live counts for the hubs: every topic's count for this viewer, and each cluster's item total. */
export function hubCounts(scope: Scope): HubCounts {
  const cached = peekHubCounts(scope);
  if (cached) return cached;
  const counts = computeHubCounts(scope);
  const { audiences, day } = countsCacheKey(scope);
  countsCache.set(audiences, { day, counts });
  return counts;
}

/** A few items to feature on a cluster hub: the newest reads and printables across its topics. */
export function clusterFeatured(clusterSlug: string, scope: Scope, limit = 6): PublicItem[] {
  const seen = new Set<string>();
  const pool: HubItem[] = [];
  for (const t of TOPICS.filter((x) => x.cluster === clusterSlug)) {
    for (const i of matchTopicItems(t, scope)) {
      if (i.type !== 'article' && i.type !== 'printable') continue;
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      pool.push(i);
    }
  }
  return pool.sort(byNewest).slice(0, limit).map((i) => i.pub);
}

/** The worlds as the cards need them, from the brand kit (the same source the database is seeded from). */
export const hubWorlds: ReadonlyMap<string, World> = new Map(
  Object.entries(brands).map(([slug, b], i) => [slug, {
    slug, name: b.name, promise: b.promise, description: b.description, icon: b.icon, color: b.color, sort: i,
  }]),
);
