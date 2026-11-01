// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { authenticate, type Agent } from '@/lib/agents/auth';
import { getBrief, submitItem, getItemStatus } from '@/lib/agents/api';
import { createItem } from '@/lib/items/repo';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let play: Agent;
let grow: Agent;
let discover: Agent;
let kidsAgent: Agent;
let master: Agent;
const keys: string[] = [];
const NOW = new Date('2026-10-31T12:00:00Z');
const okProbe = () => vi.fn(async () => ({ status: 200, location: null as string | null }));
const deps = () => ({ probe: okProbe(), now: NOW });
let n = 0;

async function agentFor(name: string, world: string | null): Promise<Agent> {
  const { key } = await createAgent(db, name, world);
  keys.push(key);
  return (await authenticate(db, key))!;
}

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  play = await agentFor('play-agent', 'play');
  grow = await agentFor('grow-agent', 'grow');
  discover = await agentFor('discover-agent', 'discover');
  kidsAgent = await agentFor('kids-agent', 'kids');
  master = await agentFor('master', null);
});
afterAll(async () => {
  await db.close();
});

const explanation = 'Because the explanation has to be long enough to teach something.';
const quiz = (over: Record<string, unknown> = {}) => ({
  kind: 'quiz', slug: `quiz-${++n}-slug`, title: `Quiz title number ${n}`, summary: 'A summary long enough to be useful here.',
  audience: 'all', topics: ['number-puzzles'], idempotencyKey: `idem-${n}-xxxxxxxx`,
  body: { mechanic: 'number', prompt: 'What comes after 2, 6, 12, 20?', difficulty: 'easy' },
  answer: { value: { value: 30, tolerance: 0 }, explanation },
  ...over,
});
const article = (over: Record<string, unknown> = {}, text = 'Shadows move because the sun appears to move across the sky.') => ({
  kind: 'article', slug: `article-${++n}-slug`, title: `Article title number ${n}`, summary: 'A summary long enough to be useful here.',
  audience: 'all', topics: [], idempotencyKey: `idem-${n}-xxxxxxxx`,
  body: { sections: [{ heading: 'One', paragraphs: [text] }, { heading: 'Two', paragraphs: ['A second short paragraph.'] }], takeaway: 'Look closely.' },
  ...over,
});
const source = { title: 'S', url: 'https://example.org/s', accessedAt: '2026-10-30' };
const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0].n);
type Json = Record<string, unknown> & { id?: string; status?: string; qualityReport?: { gates: { gate: string; ok: boolean }[]; riskTier: string; decision: string } };

describe('submitItem', () => {
  it('schedules a passing Play submission with a publish time, the answer apart from the body, and the agent recorded', async () => {
    const r = await submitItem(db, play, quiz({ idempotencyKey: 'first-submission-1' }), deps());
    expect(r.status).toBe(201);
    const j = r.json as Json;
    expect(j.status).toBe('scheduled');
    const row = (await db.query<{ publish_at: Date; created_by: string; agent_id: number; body: unknown; risk_tier: string }>(
      'SELECT publish_at, created_by, agent_id, body, risk_tier FROM items WHERE id = $1', [j.id])).rows[0];
    expect(row.publish_at.toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(row.created_by).toBe('play-agent');
    expect(row.agent_id).toBe(play.id);
    expect(row.risk_tier).toBe('computable');
    expect(JSON.stringify(row.body)).not.toMatch(/"answer"|"value"/);
    expect(await count('SELECT count(*) n FROM item_answers WHERE item_id = $1', [j.id])).toBe(1);
    expect(j.qualityReport?.gates.length).toBe(7);
  });

  it('replaying the same idempotency key returns the same item and creates no second row', async () => {
    const body = quiz({ idempotencyKey: 'replay-key-12345' });
    const first = await submitItem(db, play, body, deps());
    const before = await count('SELECT count(*) n FROM items');
    const again = await submitItem(db, play, body, deps());
    expect(again.status).toBe(200);
    expect((again.json as Json).id).toBe((first.json as Json).id);
    expect((again.json as Json).replayed).toBe(true);
    expect(await count('SELECT count(*) n FROM items')).toBe(before);
  });

  it('two simultaneous submissions with the same key create one item', async () => {
    const body = quiz({ idempotencyKey: 'concurrent-key-1' });
    const [a, b] = await Promise.all([submitItem(db, play, body, deps()), submitItem(db, play, body, deps())]);
    expect((a.json as Json).id).toBe((b.json as Json).id);
    expect(await count("SELECT count(*) n FROM items WHERE idempotency_key = 'concurrent-key-1'")).toBe(1);
  });

  it('ignores a client-supplied status and approver', async () => {
    const r = await submitItem(db, play, { ...quiz(), status: 'published', approvedBy: 'owner', approved_by: 'owner' }, deps());
    const row = (await db.query<{ status: string; approved_by: string | null }>('SELECT status, approved_by FROM items WHERE id = $1', [(r.json as Json).id])).rows[0];
    expect(row.status).toBe('scheduled');
    expect(row.approved_by).toBeNull();
  });

  it('puts a Kids-audience submission in in_review with no approver and no publish time, whatever the world', async () => {
    const r = await submitItem(db, play, article({ audience: 'kids' }, 'The sun is hot. We can see it. It helps plants grow.'), deps());
    expect(r.status).toBe(201);
    const row = (await db.query<{ status: string; approved_by: string | null; publish_at: Date | null }>(
      'SELECT status, approved_by, publish_at FROM items WHERE id = $1', [(r.json as Json).id])).rows[0];
    expect(row).toEqual({ status: 'in_review', approved_by: null, publish_at: null });
  });

  it('puts even an audience-all submission from the Kids world in in_review', async () => {
    const r = await submitItem(db, kidsAgent, article({}, 'The sun is hot. We can see it. It helps plants grow.'), deps());
    expect((r.json as Json).status).toBe('in_review');
  });

  it('stores a failing submission as a draft and names the failing gate', async () => {
    const r = await submitItem(db, discover, article({ sources: [] }), deps());
    expect(r.status).toBe(201);
    const j = r.json as Json;
    expect(j.status).toBe('draft');
    expect(j.qualityReport?.gates.filter((g) => !g.ok).map((g) => g.gate)).toEqual(['sources']);
    expect(j.qualityReport?.decision).toMatch(/gates failed/i);
  });

  it('lets an agent fix its own draft by resubmitting the same slug', async () => {
    const slug = `fixme-${++n}-slug`;
    const first = await submitItem(db, discover, article({ slug, sources: [] }), deps());
    expect((first.json as Json).status).toBe('draft');
    const fixed = await submitItem(db, discover, article({ slug, sources: [source], idempotencyKey: `fixed-${n}-xxxxxxxx` }), deps());
    expect(fixed.status).toBe(201);
    expect((fixed.json as Json).status).toBe('scheduled');
    expect(await count('SELECT count(*) n FROM items i JOIN worlds w ON w.id = i.world_id WHERE w.slug = $1 AND i.slug = $2', ['discover', slug])).toBe(1);
  });

  it('refuses to replace an item that is no longer a draft, or one that belongs to someone else', async () => {
    const slug = `locked-${++n}-slug`;
    await submitItem(db, play, quiz({ slug }), deps()); // scheduled
    expect((await submitItem(db, play, quiz({ slug }), deps())).status).toBe(409);
    const draftSlug = `theirs-${++n}-slug`;
    await submitItem(db, master, { ...article({ slug: draftSlug, sources: [] }), world: 'discover' }, deps()); // master's draft
    expect((await submitItem(db, discover, article({ slug: draftSlug, sources: [source] }), deps())).status).toBe(409);
  });

  it('stores an excluded-topic submission as a draft in the excluded tier', async () => {
    const r = await submitItem(db, grow, article({}, 'You should take two tablets of paracetamol every day to cure your fever.'), deps());
    expect((r.json as Json).status).toBe('draft');
    expect((r.json as Json).qualityReport?.riskTier).toBe('excluded');
  });

  it('rejects an invalid shape with 422 and the issues, and stores nothing', async () => {
    const before = await count('SELECT count(*) n FROM items');
    const r = await submitItem(db, play, { ...quiz(), answer: { value: 'z', explanation } , body: { mechanic: 'multiple_choice', prompt: 'Pick one please', difficulty: 'easy' } }, deps());
    expect(r.status).toBe(422);
    expect((r.json as { error: string; issues: unknown[] }).issues.length).toBeGreaterThan(0);
    expect(await count('SELECT count(*) n FROM items')).toBe(before);
  });

  it('rejects an unknown topic with 422 and stores nothing', async () => {
    const before = await count('SELECT count(*) n FROM items');
    const r = await submitItem(db, play, quiz({ topics: ['not-a-topic'] }), deps());
    expect(r.status).toBe(422);
    expect((r.json as { error: string; topics: string[] }).topics).toEqual(['not-a-topic']);
    expect(await count('SELECT count(*) n FROM items')).toBe(before);
  });

  it('rejects a body that is not an object', async () => {
    for (const bad of [null, 'text', 42, []]) expect((await submitItem(db, play, bad, deps())).status).toBe(422);
  });
});

describe('scoping', () => {
  it('a world agent cannot submit to another world, and the master can name any world', async () => {
    const before = await count('SELECT count(*) n FROM items');
    const denied = await submitItem(db, play, { ...quiz(), world: 'grow' }, deps());
    expect(denied.status).toBe(403);
    expect(await count('SELECT count(*) n FROM items')).toBe(before);
    const ok = await submitItem(db, master, { ...quiz(), world: 'grow' }, deps());
    expect(ok.status).toBe(201);
    const world = (await db.query<{ slug: string }>('SELECT w.slug FROM items i JOIN worlds w ON w.id = i.world_id WHERE i.id = $1', [(ok.json as Json).id])).rows[0].slug;
    expect(world).toBe('grow');
  });

  it('the master must say which world, and the world must exist', async () => {
    expect((await submitItem(db, master, quiz(), deps())).status).toBe(400);
    expect((await submitItem(db, master, { ...quiz(), world: 'nowhere' }, deps())).status).toBe(404);
  });

  it("an agent cannot read another world's item status, and the owner and master can", async () => {
    const made = await submitItem(db, grow, quiz(), deps());
    const id = (made.json as Json).id as string;
    expect((await getItemStatus(db, play, id)).status).toBe(404);
    const own = await getItemStatus(db, grow, id);
    expect(own.status).toBe(200);
    expect((own.json as Json).status).toBe('scheduled');
    expect((await getItemStatus(db, master, id)).status).toBe(200);
  });

  it('reports the same 404 for a missing item and for an id that is not a uuid', async () => {
    expect((await getItemStatus(db, play, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await getItemStatus(db, play, 'not-a-uuid')).status).toBe(404);
    expect((await getItemStatus(db, play, "x'; DROP TABLE items;--")).status).toBe(404);
  });
});

describe('getBrief', () => {
  it("lists topics with this world's recent counts, the newest 30 titles, and days of buffer", async () => {
    const dbb = await newTestDb();
    try {
      await seedReference(dbb);
      const { key } = await createAgent(dbb, 'brief-play', 'play');
      const agent = (await authenticate(dbb, key))!;
      const worlds = (await dbb.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds')).rows;
      const playId = worlds.find((w) => w.slug === 'play')!.id;
      const growId = worlds.find((w) => w.slug === 'grow')!.id;
      const make = (worldId: number, i: number, status: 'draft' | 'scheduled', topics: string[], publishAt?: Date) =>
        createItem(dbb, { worldId, kind: 'article', slug: `b-${worldId}-${i}`, title: `Title ${worldId}-${i}`, summary: 'A summary', body: {}, audience: 'all', createdBy: 't', riskTier: 'reflective', status, topics, publishAt });
      const real = new Date();
      for (let i = 0; i < 32; i++) await make(playId, i, 'draft', i < 5 ? ['physics'] : []);
      await make(growId, 1, 'draft', ['physics']);
      await make(playId, 100, 'scheduled', [], new Date(real.getTime() + 2 * 86_400_000));
      await make(playId, 101, 'scheduled', [], new Date(real.getTime() + 2 * 86_400_000));
      await make(playId, 102, 'scheduled', [], new Date(real.getTime() + 5 * 86_400_000));
      const r = await getBrief(dbb, agent, null, real);
      expect(r.status).toBe(200);
      const j = r.json as { today: string; world: { slug: string; approvalMode: string; bufferDays: number }; supported: { kinds: string[]; mechanics: string[] }; topics: { slug: string; recentCount: number }[]; recentTitles: string[]; scheduledDaysAhead: number };
      expect(j.world).toMatchObject({ slug: 'play', approvalMode: 'auto', bufferDays: 3 });
      expect(j.supported.kinds).toEqual(['article', 'game', 'quiz', 'video_script']);
      expect(j.supported.mechanics).toHaveLength(7);
      expect(j.topics.find((t) => t.slug === 'physics')?.recentCount).toBe(5); // play's five, not grow's one
      expect(j.topics.length).toBeGreaterThan(40);
      expect(j.recentTitles).toHaveLength(30);
      expect(j.recentTitles.every((t) => t.startsWith('Title ' + playId))).toBe(true); // nothing from grow
      expect(j.scheduledDaysAhead).toBe(2);
      expect(j.today).toBe(real.toISOString().slice(0, 10));
    } finally {
      await dbb.close();
    }
  });

  it('needs a world from the master, and refuses a world agent asking for another world', async () => {
    expect((await getBrief(db, master, null)).status).toBe(400);
    expect((await getBrief(db, master, 'grow')).status).toBe(200);
    expect((await getBrief(db, master, 'nowhere')).status).toBe(404);
    expect((await getBrief(db, play, 'grow')).status).toBe(403);
    expect((await getBrief(db, play, 'play')).status).toBe(200);
  });
});

describe('what a response may contain', () => {
  it('never includes a key hash or key prefix material beyond what the caller sent', async () => {
    const responses = [
      await submitItem(db, play, quiz(), deps()),
      await submitItem(db, play, { ...quiz(), world: 'grow' }, deps()),
      await getBrief(db, play, null),
      await getItemStatus(db, play, '00000000-0000-0000-0000-000000000000'),
    ];
    const hashes = (await db.query<{ key_hash: string }>('SELECT key_hash FROM agents')).rows.map((r) => r.key_hash);
    const text = JSON.stringify(responses);
    for (const h of hashes) expect(text).not.toContain(h);
    for (const k of keys) expect(text).not.toContain(k);
  });

  it('does not leak a stack trace or SQL in an error', async () => {
    const r = await submitItem(db, play, { ...quiz(), topics: ["x'); DROP TABLE items;--"] }, deps());
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json)).not.toMatch(/at \w+ \(|node_modules|SELECT |INSERT /);
  });
});
