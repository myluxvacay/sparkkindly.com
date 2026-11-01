// @vitest-environment node
import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { worldSeeds } from '@/db/seed/worlds';
import { getPublicItem, listPublic, searchPublic, listQuizzes, latestQuiz } from '@/lib/public/reads';
import { listWorlds, getWorld, getTopic } from '@/lib/public/worlds';
import { anonymousScope, RESERVED_WORLD_SLUGS, type Scope } from '@/lib/public/scope';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-01T12:00:00Z');
const anon: Scope = anonymousScope(NOW);
const child: Scope = { audiences: ['kids', 'all'], now: NOW };
const none: Scope = { audiences: [], now: NOW };
let n = 0;

type Put = {
  world?: string;
  slug?: string;
  kind?: string;
  title?: string;
  summary?: string;
  audience?: string;
  status?: string;
  publishedAt?: string | null;
  topics?: string[];
};
async function put(over: Put = {}): Promise<string> {
  const o = {
    world: 'play', kind: 'article', title: 'A title', summary: 'A summary of the item.', audience: 'all',
    status: 'published', publishedAt: '2026-10-31T00:00:00Z', ...over,
  };
  const slug = o.slug ?? `item-${++n}`;
  const w = await db.query<{ id: number }>('SELECT id FROM worlds WHERE slug = $1', [o.world]);
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,$7,$8,'test','computable','test') RETURNING id`,
    [w.rows[0].id, o.kind, slug, o.title, o.summary, o.audience, o.status, o.publishedAt],
  );
  for (const t of o.topics ?? []) {
    await db.query('INSERT INTO item_topics (item_id, topic_id) SELECT $1, id FROM topics WHERE slug = $2', [r.rows[0].id, t]);
  }
  return slug;
}
const slugs = (items: { slug: string }[]) => items.map((i) => i.slug).sort();
const page = { limit: 50, offset: 0 };

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  await db.query("INSERT INTO worlds (slug, name, enabled) VALUES ('hidden', 'Hidden', false)");
});
afterAll(async () => {
  await db.close();
});

describe('visibility applies to every read', () => {
  it('returns a published article from detail, list, topic list, search and quiz reads', async () => {
    const a = await put({ slug: 'vis-article', title: 'Visible yak article', topics: ['physics'] });
    const q = await put({ slug: 'vis-quiz', kind: 'quiz', title: 'Visible yak quiz', publishedAt: '2026-10-31T10:00:00Z' });
    expect((await getPublicItem(db, anon, 'play', a))?.slug).toBe(a);
    expect(slugs(await listPublic(db, anon, page))).toEqual(expect.arrayContaining([a, q]));
    expect(slugs(await listPublic(db, anon, { topic: 'physics', ...page }))).toContain(a);
    expect(slugs(await searchPublic(db, anon, 'yak', page))).toEqual([a, q].sort());
    expect(slugs(await listQuizzes(db, anon, page))).toContain(q);
    expect((await latestQuiz(db, anon))?.slug).toBeTruthy();
  });

  it.each(['draft', 'scheduled', 'in_review', 'rejected', 'archived'])('a %s item is invisible everywhere', async (status) => {
    const s = await put({ slug: `hide-${status.replace("_", "-")}`, status, title: 'Zorbax hidden', publishedAt: null, topics: ['physics'] });
    expect(await getPublicItem(db, anon, 'play', s)).toBeNull();
    expect(slugs(await listPublic(db, anon, page))).not.toContain(s);
    expect(slugs(await listPublic(db, anon, { topic: 'physics', ...page }))).not.toContain(s);
    expect(slugs(await searchPublic(db, anon, 'zorbax', page))).not.toContain(s);
  });

  it('a future published_at, a video_script and an item in a disabled world are invisible', async () => {
    const future = await put({ slug: 'hide-future', title: 'Quibble future', publishedAt: '2026-12-01T00:00:00Z' });
    const video = await put({ slug: 'hide-video', kind: 'video_script', title: 'Quibble video' });
    const hidden = await put({ slug: 'hide-world', world: 'hidden', title: 'Quibble world' });
    for (const [world, s] of [['play', future], ['play', video], ['hidden', hidden]] as const) {
      expect(await getPublicItem(db, anon, world, s)).toBeNull();
    }
    expect(slugs(await searchPublic(db, anon, 'quibble', page))).toEqual([]);
    const listed = slugs(await listPublic(db, anon, page));
    for (const s of [future, video, hidden]) expect(listed).not.toContain(s);
  });
});

describe('audience scope is a safety filter', () => {
  it('a child-like scope never receives an adults item from any read', async () => {
    const s = await put({
      slug: 'adults-only', audience: 'adults', title: 'Marmot adults', kind: 'quiz', topics: ['physics'],
      publishedAt: '2026-10-31T23:00:00Z',
    });
    expect(await getPublicItem(db, child, 'play', s)).toBeNull();
    expect(slugs(await listPublic(db, child, page))).not.toContain(s);
    expect(slugs(await listPublic(db, child, { topic: 'physics', ...page }))).not.toContain(s);
    expect(slugs(await searchPublic(db, child, 'marmot', page))).toEqual([]);
    expect(slugs(await listQuizzes(db, child, page))).not.toContain(s);
    expect((await latestQuiz(db, child))?.slug).not.toBe(s);
    expect(await getPublicItem(db, anon, 'play', s)).not.toBeNull();
  });

  it('an empty audience list returns nothing from every read', async () => {
    expect(await getPublicItem(db, none, 'play', 'vis-article')).toBeNull();
    expect(await listPublic(db, none, page)).toEqual([]);
    expect(await searchPublic(db, none, 'yak', page)).toEqual([]);
    expect(await listQuizzes(db, none, page)).toEqual([]);
    expect(await latestQuiz(db, none)).toBeNull();
  });
});

describe('what a public item carries', () => {
  it('has no answer data, even for a quiz that has a stored answer', async () => {
    const s = await put({ slug: 'carry-quiz', kind: 'quiz', topics: ['space', 'physics'] });
    await db.query("INSERT INTO item_answers (item_id, answer, explanation) SELECT id, '\"c\"'::jsonb, 'Because the explanation says so, at length.' FROM items WHERE slug = $1", [s]);
    const pub = await getPublicItem(db, anon, 'play', s);
    expect(JSON.stringify(pub)).not.toMatch(/answer|explanation|correct/i);
    expect(Object.keys(pub!)).not.toContain('answer');
    expect([...pub!.topics].sort()).toEqual(['physics', 'space']);
  });
});

describe('listing', () => {
  it('filters by world and kind, newest first, and honours limit and offset', async () => {
    await put({ slug: 'ord-old', world: 'grow', publishedAt: '2026-10-01T00:00:00Z' });
    await put({ slug: 'ord-new', world: 'grow', publishedAt: '2026-10-02T00:00:00Z' });
    const grow = await listPublic(db, anon, { world: 'grow', ...page });
    expect(grow.map((i) => i.slug)).toEqual(['ord-new', 'ord-old']);
    expect((await listPublic(db, anon, { world: 'grow', limit: 1, offset: 1 })).map((i) => i.slug)).toEqual(['ord-old']);
    expect((await listPublic(db, anon, { kind: 'quiz', ...page })).every((i) => i.kind === 'quiz')).toBe(true);
  });

  it('clamps limit to 50 and a negative offset to 0, and tolerates NaN', async () => {
    for (let i = 0; i < 3; i++) await put({ world: 'discover' });
    expect((await listPublic(db, anon, { world: 'discover', limit: 9999, offset: 0 })).length).toBeLessThanOrEqual(50);
    expect(await listPublic(db, anon, { world: 'discover', limit: 2, offset: -5 })).toHaveLength(2);
    expect((await listPublic(db, anon, { world: 'discover', limit: Number.NaN, offset: Number.NaN })).length).toBeGreaterThan(0);
  });

  it('latestQuiz moves on at the exact second a quiz becomes due, and takes the later of two in one day', async () => {
    const dbq = await newTestDb();
    try {
      await seedReference(dbq);
      const q = (slug: string, at: string) =>
        dbq.query(
          `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
           SELECT id,'quiz',$1,'Quiz','A summary of the quiz.','{}'::jsonb,'all','published',$2,'t','computable','t' FROM worlds WHERE slug='play'`,
          [slug, at],
        );
      await q('q-a', '2026-10-30T06:00:00Z');
      await q('q-b', '2026-10-31T06:00:00Z');
      await q('q-c', '2026-10-31T18:00:00Z');
      const at = (iso: string) => anonymousScope(new Date(iso));
      expect((await latestQuiz(dbq, at('2026-10-31T05:59:59Z')))?.slug).toBe('q-a');
      expect((await latestQuiz(dbq, at('2026-10-31T06:00:00Z')))?.slug).toBe('q-b');
      expect((await latestQuiz(dbq, at('2026-11-01T00:00:00Z')))?.slug).toBe('q-c');
      expect(await latestQuiz(dbq, at('2026-10-01T00:00:00Z'))).toBeNull();
    } finally {
      await dbq.close();
    }
  });
});

describe('search', () => {
  it('ranks a title hit above a summary hit', async () => {
    await put({ slug: 'rank-summary', title: 'Plain title', summary: 'This one mentions gryphon only in the summary.' });
    await put({ slug: 'rank-title', title: 'Gryphon in the title', summary: 'Nothing else relevant at all here.' });
    const r = await searchPublic(db, anon, 'gryphon', { limit: 10, offset: 0 });
    expect(r.map((i) => i.slug)).toEqual(['rank-title', 'rank-summary']);
  });

  it('survives operators, empty input, huge input and SQL text without error or damage', async () => {
    for (const q of ['a & | ! ( b :*', '', '   ', 'x'.repeat(10_000), "'; drop table items;--", '"unbalanced', ':*:*', '\\']) {
      await expect(searchPublic(db, anon, q, { limit: 10, offset: 0 })).resolves.toBeInstanceOf(Array);
    }
    expect((await db.query<{ c: number }>('SELECT count(*)::int AS c FROM items')).rows[0].c).toBeGreaterThan(0);
    expect(await searchPublic(db, anon, '   ', { limit: 10, offset: 0 })).toEqual([]);
  });
});

describe('worlds and topics', () => {
  it('lists only enabled worlds in order and finds one by slug', async () => {
    const ws = await listWorlds(db);
    expect(ws.map((w) => w.slug)).toEqual(worldSeeds.map((w) => w.slug));
    expect((await getWorld(db, 'play'))?.name).toBe('Play');
    expect(await getWorld(db, 'hidden')).toBeNull();
    expect(await getWorld(db, 'nope')).toBeNull();
  });

  it('getTopic returns a known topic and null for an unknown one', async () => {
    expect(await getTopic(db, 'physics')).toMatchObject({ slug: 'physics' });
    expect(await getTopic(db, 'no-such-topic')).toBeNull();
  });
});

describe('reserved world slugs', () => {
  it('no launch world uses a reserved slug', () => {
    for (const w of worldSeeds) expect(RESERVED_WORLD_SLUGS, w.slug).not.toContain(w.slug);
  });

  it('every plain top-level route name under app/ is reserved, so a world can never shadow a page', () => {
    const dirs = (p: string) => fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    const plain = (names: string[]) => names.filter((d) => !d.startsWith('(') && !d.startsWith('['));
    const top = dirs('app');
    const grouped = top.filter((d) => d.startsWith('(')).flatMap((g) => dirs(`app/${g}`));
    for (const name of plain([...top, ...grouped])) expect(RESERVED_WORLD_SLUGS, name).toContain(name);
  });
});
