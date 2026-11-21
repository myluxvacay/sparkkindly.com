// @vitest-environment node
// updateSectionImages: the guarded sync that pushes section images (the step strip) from the content files
// into existing article rows. The legacy import is insert-only, so without this a strip added to an imported
// article never reaches the page. Only the `image` key of stored body sections changes; a stored article
// whose headings do not cover the file's imaged sections is skipped untouched, and a second run is a no-op.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { readFolder } from '@/lib/repository';
import { articleSchema, type Article } from '@/lib/schemas';
import { seedReference } from '@/db/seed';
import { importLegacy } from '@/lib/items/import-legacy';
import { updateSectionImages } from '@/lib/items/update-section-images';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let volcano: Article;

const storedSections = async () => {
  const r = await db.query<{ body: { sections: { heading: string; image?: { src: string } }[] } }>(
    "SELECT body FROM items WHERE kind = 'article' AND slug = $1",
    [volcano.slug],
  );
  return r.rows[0].body.sections;
};

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const articles = readFolder('articles').map((a) => articleSchema.parse(a));
  volcano = articles.find((a) => a.slug === 'volcano-model')!;
  // Import the pre-strip revision: the same article with the section image removed, as the row stood
  // before the strip was authored.
  const preStrip: Article = {
    ...volcano,
    body: volcano.body.map((s) => {
      const { image: _image, ...rest } = s;
      return rest;
    }),
  };
  await importLegacy(db, [preStrip], []);
});
afterAll(async () => {
  await db.close();
});

describe('updateSectionImages', () => {
  it('adds the strip to the stored section, touches nothing else, and is idempotent', async () => {
    const before = await storedSections();
    expect(before.every((s) => !s.image)).toBe(true);
    const result = await updateSectionImages(db, [volcano]);
    expect(result).toEqual({ updated: 1, unchanged: 0, missing: 0, skipped: 0 });
    const after = await storedSections();
    const steps = after.find((s) => s.heading === 'How it works — step by step');
    expect(steps?.image?.src).toBe('/images/poster-volcano-model-steps.webp');
    // Every other section is byte-identical in content (headings + paragraphs preserved).
    expect(after.map((s) => s.heading)).toEqual(before.map((s) => s.heading));
    const again = await updateSectionImages(db, [volcano]);
    expect(again).toEqual({ updated: 0, unchanged: 1, missing: 0, skipped: 0 });
  });

  it('skips an article whose stored headings do not cover the imaged section', async () => {
    const renamed: Article = {
      ...volcano,
      body: volcano.body.map((s) => (s.image ? { ...s, heading: 'A heading the database does not have' } : s)),
    };
    const result = await updateSectionImages(db, [renamed]);
    expect(result).toEqual({ updated: 0, unchanged: 0, missing: 0, skipped: 1 });
  });

  it('reports an article that is not in the database as missing', async () => {
    const ghost: Article = { ...volcano, id: 'poster-ghost', slug: 'ghost-article' };
    const result = await updateSectionImages(db, [ghost]);
    expect(result).toEqual({ updated: 0, unchanged: 0, missing: 1, skipped: 0 });
  });
});
