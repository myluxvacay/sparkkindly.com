// @vitest-environment node
// updateHeroImages: the guarded sync that pushes hero changes from the content files into existing article
// rows. The legacy import is insert-only, so without this a new hero never reaches an imported article. Only
// items.image changes; quizzes and other columns are untouched, and a second run is a no-op.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { readFolder } from '@/lib/repository';
import { articleSchema, quizSchema, type Article } from '@/lib/schemas';
import { seedReference } from '@/db/seed';
import { importLegacy } from '@/lib/items/import-legacy';
import { updateHeroImages } from '@/lib/items/update-heroes';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let article: Article;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const articles = readFolder('articles').map((a) => articleSchema.parse(a));
  const quizzes = readFolder('quizzes').map((q) => quizSchema.parse(q));
  article = articles.find((a) => a.slug === 'how-a-jet-engine-works') ?? articles[0];
  await importLegacy(db, [article], [quizzes[0]]);
});
afterAll(async () => {
  await db.close();
});

const storedImage = async () => {
  const r = await db.query<{ image: { src: string; alt: string } }>(
    "SELECT image FROM items WHERE kind = 'article' AND slug = $1",
    [article.slug],
  );
  return r.rows[0].image;
};

describe('updateHeroImages', () => {
  it('reports no change when the stored hero already matches the file', async () => {
    const before = await storedImage();
    expect(before.src).toBe(article.hero.src);
    const result = await updateHeroImages(db, [article]);
    expect(result).toEqual({ updated: 0, unchanged: 1, missing: 0 });
  });

  it('updates only the image when the file hero changes, and is idempotent', async () => {
    const changed: Article = {
      ...article,
      hero: { ...article.hero, src: '/images/science.webp', alt: 'A microscope in a bright laboratory' },
    };
    const result = await updateHeroImages(db, [changed]);
    expect(result).toEqual({ updated: 1, unchanged: 0, missing: 0 });
    const after = await storedImage();
    expect(after.src).toBe('/images/science.webp');
    expect(after.alt).toBe('A microscope in a bright laboratory');
    const again = await updateHeroImages(db, [changed]);
    expect(again).toEqual({ updated: 0, unchanged: 1, missing: 0 });
    // The article row itself is otherwise untouched.
    const row = await db.query<{ title: string; status: string }>('SELECT title, status FROM items WHERE slug = $1', [
      article.slug,
    ]);
    expect(row.rows[0].title).toBe(article.title);
  });

  it('counts articles that are not in the database and never touches quizzes', async () => {
    const ghost: Article = { ...article, slug: 'no-such-article-anywhere' };
    const result = await updateHeroImages(db, [ghost]);
    expect(result).toEqual({ updated: 0, unchanged: 0, missing: 1 });
    const quizBefore = await db.query<{ image: unknown }>("SELECT image FROM items WHERE kind = 'quiz'");
    const changed: Article = { ...article, hero: { ...article.hero, src: '/images/space.webp' } };
    await updateHeroImages(db, [changed]);
    const quizAfter = await db.query<{ image: unknown }>("SELECT image FROM items WHERE kind = 'quiz'");
    expect(JSON.stringify(quizAfter.rows[0].image)).toBe(JSON.stringify(quizBefore.rows[0].image));
  });
});
