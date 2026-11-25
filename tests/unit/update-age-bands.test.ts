// @vitest-environment node
// updateAgeBandTopics: the guarded, insert-only sync that adds age-band topic links to
// already-imported items from their content files' ageBands fields. Tested against a fake Db
// (the pattern of stubbing the two query shapes the sync issues), so the counting, matching
// and insert-only behaviour are pinned without a database.
import { describe, it, expect } from 'vitest';
import type { Db } from '@/lib/db';
import type { Article, Game, Quiz } from '@/lib/schemas';
import { updateAgeBandTopics } from '@/lib/items/update-age-bands';

// A minimal in-memory Db: items keyed by world/slug/kind, with the band topics that exist and
// the links already present. The sync issues exactly two queries — the item lookup and the
// insert-select over topics — and the fake answers those two shapes only.
function fakeDb(seed: {
  items: { world: string; slug: string; kind: string; id: string }[];
  topics?: string[];
  links?: Record<string, string[]>;
}) {
  const topics = new Set(seed.topics ?? ['ages-3-5', 'ages-6-8', 'ages-9-12']);
  const links = new Map<string, Set<string>>(
    Object.entries(seed.links ?? {}).map(([id, ts]) => [id, new Set(ts)]),
  );
  const db = {
    async query(text: string, params?: unknown[]) {
      if (text.includes('SELECT i.id FROM items')) {
        const [world, slug, kind] = params as [string, string, string];
        const row = seed.items.find((i) => i.world === world && i.slug === slug && i.kind === kind);
        return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
      }
      if (text.includes('INSERT INTO item_topics')) {
        const [itemId, wanted] = params as [string, string[]];
        const have = links.get(itemId) ?? new Set<string>();
        links.set(itemId, have);
        const inserted: { topic_id: number }[] = [];
        for (const t of wanted) {
          if (topics.has(t) && !have.has(t)) {
            have.add(t);
            inserted.push({ topic_id: inserted.length + 1 });
          }
        }
        return { rows: inserted, rowCount: inserted.length };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db: db as unknown as Db, links };
}

const article = (over: Partial<Article>): Article => ({ brand: 'discover', slug: 'a-one', ageBands: ['6-8'], ...over }) as Article;
const quiz = (over: Partial<Quiz>): Quiz => ({ brand: 'play', id: 'q-one', ageBands: ['3-5'], ...over }) as unknown as Quiz;
const game = (over: Partial<Game>): Game => ({ brand: 'play', id: 'g-one', ageBands: ['9-12'], ...over }) as unknown as Game;

describe('updateAgeBandTopics', () => {
  it('adds the declared band links for articles, quizzes (by content id) and games', async () => {
    const { db, links } = fakeDb({
      items: [
        { world: 'discover', slug: 'a-one', kind: 'article', id: 'item-a' },
        { world: 'play', slug: 'q-one', kind: 'quiz', id: 'item-q' },
        { world: 'play', slug: 'g-one', kind: 'game', id: 'item-g' },
      ],
    });
    const result = await updateAgeBandTopics(db, [article({})], [quiz({})], [game({})]);
    expect(result).toEqual({ added: 3, unchanged: 0, missing: 0 });
    expect([...(links.get('item-a') ?? [])]).toEqual(['ages-6-8']);
    expect([...(links.get('item-q') ?? [])]).toEqual(['ages-3-5']);
    expect([...(links.get('item-g') ?? [])]).toEqual(['ages-9-12']);
  });

  it('is idempotent: a second run adds nothing and counts the items unchanged', async () => {
    const { db } = fakeDb({ items: [{ world: 'discover', slug: 'a-one', kind: 'article', id: 'item-a' }] });
    await updateAgeBandTopics(db, [article({ ageBands: ['3-5', '6-8'] })], [], []);
    const again = await updateAgeBandTopics(db, [article({ ageBands: ['3-5', '6-8'] })], [], []);
    expect(again).toEqual({ added: 0, unchanged: 1, missing: 0 });
  });

  it('counts family-only and unbanded items as unchanged and links nothing for them', async () => {
    const { db, links } = fakeDb({ items: [{ world: 'discover', slug: 'a-one', kind: 'article', id: 'item-a' }] });
    const result = await updateAgeBandTopics(
      db,
      [article({ ageBands: ['family'] }), article({ slug: 'a-two', ageBands: undefined })],
      [],
      [],
    );
    expect(result).toEqual({ added: 0, unchanged: 2, missing: 0 });
    expect(links.size).toBe(0);
  });

  it('reports items that are not in the database as missing', async () => {
    const { db } = fakeDb({ items: [] });
    const result = await updateAgeBandTopics(db, [article({})], [quiz({})], []);
    expect(result).toEqual({ added: 0, unchanged: 0, missing: 2 });
  });

  it('never removes a link the sync did not create (insert-only)', async () => {
    const { db, links } = fakeDb({
      items: [{ world: 'discover', slug: 'a-one', kind: 'article', id: 'item-a' }],
      links: { 'item-a': ['ages-9-12'] }, // an owner-added link the content file does not declare
    });
    const result = await updateAgeBandTopics(db, [article({ ageBands: ['6-8'] })], [], []);
    expect(result.added).toBe(1);
    expect([...(links.get('item-a') ?? [])].sort()).toEqual(['ages-6-8', 'ages-9-12']);
  });

  it('matches on kind as well as world and slug', async () => {
    const { db } = fakeDb({ items: [{ world: 'play', slug: 'q-one', kind: 'article', id: 'item-x' }] });
    const result = await updateAgeBandTopics(db, [], [quiz({})], []);
    expect(result).toEqual({ added: 0, unchanged: 0, missing: 1 });
  });
});
