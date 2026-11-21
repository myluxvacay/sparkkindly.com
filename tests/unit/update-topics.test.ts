// @vitest-environment node
// updateItemTopics: the guarded sync that adds topic links to already-imported articles when a
// content tag later becomes a topic (the reading series' structural tags, migration 043). The
// legacy import is insert-only and drops unknown tags, so without this the links never arrive.
// Insert-only itself: it adds links, never removes them, and touches nothing but item_topics.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { readFolder } from '@/lib/repository';
import { articleSchema, type Article } from '@/lib/schemas';
import { seedReference } from '@/db/seed';
import { importLegacy } from '@/lib/items/import-legacy';
import { updateItemTopics } from '@/lib/items/update-topics';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let article: Article;

const STRUCTURAL = ['reading', 'poster-series', 'grammar', 'phonics', 'vocabulary', 'explainers', 'pre-k', 'grades-k-2', 'grades-3-5'];

const linkedTopics = async (slug: string) => {
  const r = await db.query<{ slug: string }>(
    `SELECT t.slug FROM item_topics it JOIN topics t ON t.id = it.topic_id
     JOIN items i ON i.id = it.item_id WHERE i.slug = $1 ORDER BY t.slug`,
    [slug],
  );
  return r.rows.map((x) => x.slug);
};

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const articles = readFolder('articles').map((a) => articleSchema.parse(a));
  const base = articles.find((a) => a.slug === 'how-a-jet-engine-works') ?? articles[0];
  // Simulate the pre-043 world: the structural topics do not exist yet, so the import drops the
  // article's structural tags and keeps only the tags that already had topic rows ('kindness' is a
  // long-standing topic). The fixture's tag set is fixed so the counts below are exact.
  await db.query('DELETE FROM topics WHERE slug = ANY($1)', [STRUCTURAL]);
  article = { ...base, tags: ['kindness', 'reading', 'poster-series', 'grades-k-2'] };
  await importLegacy(db, [article], []);
});
afterAll(async () => {
  await db.close();
});

describe('updateItemTopics', () => {
  it('starts from the import state: structural tags were dropped, known tags kept', async () => {
    const linked = await linkedTopics(article.slug);
    expect(linked).toEqual(['kindness']);
  });

  it('adds the missing links once the topics exist, and is idempotent', async () => {
    await seedReference(db); // the topics arrive (as migration 043 delivers them on a real database)
    const first = await updateItemTopics(db, [article]);
    expect(first).toEqual({ added: 3, unchanged: 0, missing: 0 });
    const linked = await linkedTopics(article.slug);
    expect(linked).toContain('reading');
    expect(linked).toContain('poster-series');
    expect(linked).toContain('grades-k-2');
    const again = await updateItemTopics(db, [article]);
    expect(again).toEqual({ added: 0, unchanged: 1, missing: 0 });
  });

  it('reports an article that is not in the database as missing', async () => {
    const ghost: Article = { ...article, slug: 'no-such-article-anywhere' };
    const result = await updateItemTopics(db, [ghost]);
    expect(result).toEqual({ added: 0, unchanged: 0, missing: 1 });
  });

  it('never removes a link the sync did not create', async () => {
    // An owner-added link (a topic the content file does not declare) survives the sync untouched.
    await db.query(
      `INSERT INTO item_topics (item_id, topic_id)
       SELECT i.id, t.id FROM items i, topics t WHERE i.slug = $1 AND t.slug = 'curiosity'
       ON CONFLICT DO NOTHING`,
      [article.slug],
    );
    await updateItemTopics(db, [article]);
    expect(await linkedTopics(article.slug)).toContain('curiosity');
  });
});
