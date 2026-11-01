// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { readFolder } from '@/lib/repository';
import { articleSchema, quizSchema, type Article, type Quiz } from '@/lib/schemas';
import { seedReference } from '@/db/seed';
import { importLegacy } from '@/lib/items/import-legacy';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const articles: Article[] = readFolder('articles').map((a) => articleSchema.parse(a));
const quizzes: Quiz[] = readFolder('quizzes').map((q) => quizSchema.parse(q));

const count = async (sql: string) => Number((await db.query<{ n: string }>(sql)).rows[0].n);

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

describe('seedReference', () => {
  it('creates five worlds with Kids in review mode and the rest on auto', async () => {
    await seedReference(db);
    const r = await db.query<{ slug: string; approval_mode: string }>('SELECT slug, approval_mode FROM worlds ORDER BY sort');
    expect(r.rows.map((w) => w.slug)).toEqual(['play', 'discover', 'together', 'grow', 'kids']);
    expect(r.rows.find((w) => w.slug === 'kids')?.approval_mode).toBe('review');
    expect(r.rows.filter((w) => w.approval_mode === 'auto')).toHaveLength(4);
  });

  it('is idempotent and does not overwrite an owner change', async () => {
    await db.query("UPDATE worlds SET buffer_days = 7 WHERE slug = 'play'");
    const before = [await count('SELECT count(*) n FROM worlds'), await count('SELECT count(*) n FROM topics')];
    await seedReference(db);
    expect([await count('SELECT count(*) n FROM worlds'), await count('SELECT count(*) n FROM topics')]).toEqual(before);
    expect(await count("SELECT buffer_days n FROM worlds WHERE slug = 'play'")).toBe(7);
    expect(before[1]).toBeGreaterThanOrEqual(40);
  });

  it('gives topics parents where the curated list groups them', async () => {
    const r = await db.query<{ n: string }>("SELECT count(*) n FROM topics t JOIN topics p ON p.id = t.parent_id WHERE p.slug = 'science'");
    expect(Number(r.rows[0].n)).toBeGreaterThanOrEqual(3);
  });
});

describe('importLegacy', () => {
  it('imports 10 articles and 14 quizzes as 24 published items', async () => {
    const result = await importLegacy(db, articles, quizzes);
    expect(result).toEqual({ items: 24, answers: 14 });
    expect(await count("SELECT count(*) n FROM items WHERE status = 'published'")).toBe(24);
    expect(await count("SELECT count(*) n FROM items WHERE kind = 'article'")).toBe(10);
    expect(await count("SELECT count(*) n FROM items WHERE kind = 'quiz'")).toBe(14);
  });

  it('gives every item a world, an audience and a risk tier, and Kids items the Kids tier', async () => {
    expect(await count('SELECT count(*) n FROM items i JOIN worlds w ON w.id = i.world_id WHERE i.audience IS NOT NULL AND i.risk_tier IS NOT NULL')).toBe(24);
    expect(await count("SELECT count(*) n FROM items i JOIN worlds w ON w.id = i.world_id WHERE w.slug = 'kids' AND i.audience = 'kids' AND i.risk_tier = 'kids'")).toBe(4);
    expect(await count("SELECT count(*) n FROM items i JOIN worlds w ON w.id = i.world_id WHERE w.slug <> 'kids' AND i.audience = 'kids'")).toBe(0);
  });

  it('records the owner as approver on every published item, so Kids items satisfy the database check', async () => {
    expect(await count("SELECT count(*) n FROM items WHERE status = 'published' AND approved_by IS NULL")).toBe(0);
  });

  it('never stores the correct answer inside a quiz body', async () => {
    const bodies = await db.query<{ body: Record<string, unknown> }>("SELECT body FROM items WHERE kind = 'quiz'");
    expect(bodies.rows).toHaveLength(14);
    for (const { body } of bodies.rows) {
      expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['correctOptionId']));
      expect(JSON.stringify(body)).not.toMatch(/correctOptionId|"answer"|"correct"/);
      expect(body.mechanic).toBe('multiple_choice');
    }
    expect(await count('SELECT count(*) n FROM item_answers')).toBe(14);
  });

  it('stores the correct option id and the explanation in item_answers', async () => {
    const quiz = quizzes.find((q) => q.id === 'number-detective-001')!;
    const r = await db.query<{ answer: string; explanation: string }>(
      "SELECT a.answer, a.explanation FROM item_answers a JOIN items i ON i.id = a.item_id WHERE i.slug = 'number-detective-001'",
    );
    expect(r.rows[0].answer).toBe(quiz.correctOptionId);
    expect(r.rows[0].explanation).toBe(quiz.explanation);
  });

  it('records image origin and licence for every article, and a template origin for quizzes', async () => {
    expect(await count("SELECT count(*) n FROM items WHERE kind = 'article' AND image->>'origin' IS NOT NULL AND image->>'licence' IS NOT NULL")).toBe(10);
    expect(await count("SELECT count(*) n FROM items WHERE kind = 'quiz' AND image->>'origin' = 'template'")).toBe(14);
  });

  it('keeps Kids article safety fields and the legacy content type in the body', async () => {
    const r = await db.query<{ body: Record<string, unknown> }>("SELECT i.body FROM items i WHERE i.slug = 'shadow-explorers'");
    const body = r.rows[0].body;
    expect(body.ageGuidance).toBe('Ages 6–9, with an adult');
    expect((body.materials as string[]).length).toBeGreaterThan(0);
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.legacyContentType).toBe('activity');
  });

  it('links tags to topics where a topic exists', async () => {
    expect(await count("SELECT count(*) n FROM item_topics it JOIN topics t ON t.id = it.topic_id WHERE t.slug = 'curiosity'")).toBeGreaterThan(0);
  });

  it('writes a first revision for every item', async () => {
    expect(await count('SELECT count(*) n FROM item_revisions WHERE revision = 1')).toBe(24);
  });

  it('re-running the import changes no row count', async () => {
    const tables = ['items', 'item_answers', 'item_topics', 'item_revisions'];
    const before = await Promise.all(tables.map((t) => count(`SELECT count(*) n FROM ${t}`)));
    expect(await importLegacy(db, articles, quizzes)).toEqual({ items: 0, answers: 0 });
    expect(await Promise.all(tables.map((t) => count(`SELECT count(*) n FROM ${t}`)))).toEqual(before);
  });

  it('imports an article that was not approved as a draft with no approver', async () => {
    const fresh = await newTestDb();
    try {
      await seedReference(fresh);
      const draft = { ...articles[0], slug: 'unapproved-copy', id: 'x-1', reviewStatus: 'draft' as const, reviewer: null, reviewedAt: null };
      await importLegacy(fresh, [draft], []);
      const r = await fresh.query<{ status: string; approved_by: string | null }>("SELECT status, approved_by FROM items WHERE slug = 'unapproved-copy'");
      expect(r.rows[0]).toEqual({ status: 'draft', approved_by: null });
    } finally {
      await fresh.close();
    }
  });
});
