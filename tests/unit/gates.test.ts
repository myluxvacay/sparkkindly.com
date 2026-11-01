// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createItem } from '@/lib/items/repo';
import { itemSubmissionSchema, type ItemSubmission } from '@/lib/items/format';
import { runGates, riskTierFor } from '@/lib/items/gates';
import type { ProbeResult } from '@/lib/items/probe';
import { BlockedAddressError } from '@/lib/items/net-safety';
import { fleschKincaidGrade } from '@/lib/items/readability';
import { blockedWords } from '@/lib/items/blocked';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let play: { id: number; slug: string };
let discover: { id: number; slug: string };
let kids: { id: number; slug: string };
const NOW = new Date('2026-10-31T12:00:00Z');
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const w = (await db.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds')).rows;
  play = w.find((x) => x.slug === 'play')!;
  discover = w.find((x) => x.slug === 'discover')!;
  kids = w.find((x) => x.slug === 'kids')!;
});
afterAll(async () => {
  await db.close();
});

type ProbeFn = (url: string, method: 'HEAD' | 'GET', signal: AbortSignal) => Promise<ProbeResult>;
const probeOf = (fn: ProbeFn) => vi.fn(fn);
const okProbe = () => probeOf(async () => ({ status: 200, location: null }));
const explanation = 'Because the explanation has to be long enough to teach something.';

function article(over: Record<string, unknown> = {}, text = 'Shadows move because the sun appears to move across the sky.'): ItemSubmission {
  return itemSubmissionSchema.parse({
    kind: 'article', slug: `gate-${++n}-slug`, title: `Gate test title number ${n}`, summary: 'A summary long enough to be useful here.',
    audience: 'all', topics: [], sources: [{ title: 'S', url: 'https://example.org/s', accessedAt: '2026-10-30' }],
    idempotencyKey: `key-${n}-xxxxxxxx`,
    body: { sections: [{ heading: 'One', paragraphs: [text] }, { heading: 'Two', paragraphs: ['A second short paragraph.'] }], takeaway: 'Look closely.' },
    ...over,
  });
}
function quiz(over: Record<string, unknown> = {}, body: Record<string, unknown> = {}): ItemSubmission {
  return itemSubmissionSchema.parse({
    kind: 'quiz', slug: `quiz-${++n}-slug`, title: `Quiz title number ${n}`, summary: 'A summary long enough to be useful here.',
    audience: 'all', idempotencyKey: `key-${n}-xxxxxxxx`,
    body: { mechanic: 'number', prompt: 'What comes after 2, 6, 12, 20?', difficulty: 'easy', ...body },
    answer: { value: { value: 30, tolerance: 0 }, explanation },
    ...over,
  });
}
const gate = (r: Awaited<ReturnType<typeof runGates>>, name: string) => r.results.find((x) => x.gate === name)!;

describe('fleschKincaidGrade', () => {
  it('matches the hand-computed value for a known sentence', () => {
    expect(fleschKincaidGrade('The cat sat on the mat.')).toBeCloseTo(-1.45, 1);
  });
  it('scores simple text low and dense text high', () => {
    expect(fleschKincaidGrade('The sun is hot. We can see it. It helps plants grow. Birds like the sun too.')).toBeLessThan(4);
    expect(
      fleschKincaidGrade('Photosynthesis is the biochemical process through which chlorophyll-containing organisms convert electromagnetic radiation into chemical energy, subsequently synthesizing carbohydrates from atmospheric carbon dioxide and absorbed water.'),
    ).toBeGreaterThan(10);
  });
});

describe('riskTierFor', () => {
  it('maps kids, sourced, computable and reflective', () => {
    expect(riskTierFor(article({ audience: 'kids' }), play)).toBe('kids');
    expect(riskTierFor(article(), kids)).toBe('kids');
    expect(riskTierFor(article({ sources: [] }), discover)).toBe('sourced');
    expect(riskTierFor(article(), play)).toBe('sourced');
    expect(riskTierFor(quiz(), play)).toBe('computable');
    expect(riskTierFor(article({ sources: [] }), play)).toBe('reflective');
  });
});

describe('duplicate gate', () => {
  const seed = (slug: string, title: string, world = play.id) =>
    createItem(db, { worldId: world, kind: 'article', slug, title, summary: 'A summary', body: {}, audience: 'all', createdBy: 't', riskTier: 'reflective' });

  it('fails when the slug is already used in the same world, passes in another world', async () => {
    await seed('taken-slug', 'Completely unrelated headline words');
    const dup = await runGates(db, article({ slug: 'taken-slug' }), play, { probe: okProbe(), now: NOW });
    expect(gate(dup, 'duplicate').ok).toBe(false);
    const other = await runGates(db, article({ slug: 'taken-slug' }), discover, { probe: okProbe(), now: NOW });
    expect(gate(other, 'duplicate').ok).toBe(true);
  });

  it('fails for a near-identical title created in the last 90 days', async () => {
    await seed('shadow-original', 'The shadows that move');
    const r = await runGates(db, article({ title: 'The shadows that move today' }), play, { probe: okProbe(), now: NOW });
    expect(gate(r, 'duplicate').ok).toBe(false);
    expect(gate(r, 'duplicate').reason).toMatch(/similar/i);
  });

  it('passes for the same title when the original is 91 days old', async () => {
    const old = await seed('old-original', 'Ancient lighthouse keepers stories');
    await db.query("UPDATE items SET created_at = $2::timestamptz - interval '91 days' WHERE id = $1", [old.id, NOW.toISOString()]);
    const r = await runGates(db, article({ title: 'Ancient lighthouse keepers stories' }), play, { probe: okProbe(), now: NOW });
    expect(gate(r, 'duplicate').ok).toBe(true);
  });
});

describe('blocked words and topics', () => {
  it('blocked-words: a listed word in the body fails', async () => {
    const r = await runGates(db, article({}, `This is ${blockedWords[0]} nonsense about shadows.`), play, { probe: okProbe(), now: NOW });
    expect(gate(r, 'blocked-words').ok).toBe(false);
  });
  it('blocked-words: ordinary text passes and a substring inside a longer word does not trip it', async () => {
    const r = await runGates(db, article({}, 'Classic scunthorpe-style words like assassin and bassist are fine.'), play, { probe: okProbe(), now: NOW });
    expect(gate(r, 'blocked-words').ok).toBe(true);
  });
  it('blocked-topics: medical advice phrasing fails', async () => {
    const r = await runGates(db, article({}, 'You should take two tablets of paracetamol every day to cure your fever.'), play, { probe: okProbe(), now: NOW });
    expect(gate(r, 'blocked-topics').ok).toBe(false);
    expect(gate(r, 'blocked-topics').reason).toMatch(/medical/i);
  });
  it('blocked-topics: self-harm and personal financial advice fail, an ordinary article passes', async () => {
    expect(gate(await runGates(db, article({}, 'Some people think about self-harm when they are low.'), play, { probe: okProbe(), now: NOW }), 'blocked-topics').ok).toBe(false);
    expect(gate(await runGates(db, article({}, 'Invest all your savings in this coin for guaranteed returns.'), play, { probe: okProbe(), now: NOW }), 'blocked-topics').ok).toBe(false);
    expect(gate(await runGates(db, article(), play, { probe: okProbe(), now: NOW }), 'blocked-topics').ok).toBe(true);
  });
  it('a blocked word in the image alt text, or in a source title, fails', async () => {
    const alt = await runGates(db, article({ image: { origin: 'template', licence: 'own', alt: `a ${blockedWords[0]} picture` } }), play, { probe: okProbe(), now: NOW });
    expect(gate(alt, 'blocked-words').ok).toBe(false);
    const title = await runGates(db, article({ sources: [{ title: `${blockedWords[0]} article`, url: 'https://example.org/s', accessedAt: '2026-10-30' }] }), play, { probe: okProbe(), now: NOW });
    expect(gate(title, 'blocked-words').ok).toBe(false);
  });
  it('an excluded topic in the image alt text fails', async () => {
    const r = await runGates(db, article({ image: { origin: 'template', licence: 'own', alt: 'how to make a bomb' } }), play, { probe: okProbe(), now: NOW });
    expect(gate(r, 'blocked-topics').ok).toBe(false);
  });
});

describe('sources gate', () => {
  it('a sourced-tier item with no sources fails', async () => {
    const r = await runGates(db, article({ sources: [] }), discover, { probe: okProbe(), now: NOW });
    expect(gate(r, 'sources').ok).toBe(false);
  });
  it('an unreachable url fails', async () => {
    const r = await runGates(db, article(), play, { probe: probeOf(async () => { throw new Error('ENOTFOUND'); }), now: NOW });
    expect(gate(r, 'sources').ok).toBe(false);
  });
  it('a url that answers 404 fails and one that answers 200 passes', async () => {
    expect(gate(await runGates(db, article(), play, { probe: probeOf(async () => ({ status: 404, location: null })), now: NOW }), 'sources').ok).toBe(false);
    expect(gate(await runGates(db, article(), play, { probe: okProbe(), now: NOW }), 'sources').ok).toBe(true);
  });
  it('tries GET when HEAD is refused', async () => {
    const probe = probeOf(async (_u, method) => ({ status: method === 'HEAD' ? 405 : 200, location: null }));
    const r = await runGates(db, article(), play, { probe, now: NOW });
    expect(gate(r, 'sources').ok).toBe(true);
    expect(probe.mock.calls.map((c) => c[1])).toEqual(['HEAD', 'GET']);
  });
  it('never follows more than 3 redirects', async () => {
    const probe = probeOf(async () => ({ status: 302, location: 'https://example.org/next' }));
    const r = await runGates(db, article(), play, { probe, now: NOW });
    expect(gate(r, 'sources').ok).toBe(false);
    expect(probe.mock.calls.length).toBeLessThanOrEqual(4);
  });
  it('follows a relative redirect and checks the new address text on every hop', async () => {
    const probe = probeOf(async (url) => (url.endsWith('/s') ? { status: 301, location: '/moved' } : { status: 200, location: null }));
    expect(gate(await runGates(db, article(), play, { probe, now: NOW }), 'sources').ok).toBe(true);
    const toInternal = probeOf(async () => ({ status: 302, location: 'https://192.168.1.5/admin' }));
    const r = await runGates(db, article(), play, { probe: toInternal, now: NOW });
    expect(gate(r, 'sources').ok).toBe(false);
    expect(toInternal).toHaveBeenCalledTimes(1);
  });
  it('rejects a private-network source address without probing it', async () => {
    const probe = okProbe();
    const sub = article({ sources: [{ title: 'internal', url: 'https://192.168.1.10/admin', accessedAt: '2026-10-30' }] });
    expect(gate(await runGates(db, sub, play, { probe, now: NOW }), 'sources').ok).toBe(false);
    const local = await runGates(db, article({ sources: [{ title: 'l', url: 'https://localhost./x', accessedAt: '2026-10-30' }] }), play, { probe, now: NOW });
    expect(gate(local, 'sources').ok).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
  it('fails with the reason when the connection refuses a name that resolves privately', async () => {
    const probe = probeOf(async () => { throw new BlockedAddressError('sneaky.example.org'); });
    const r = await runGates(db, article(), play, { probe, now: NOW });
    expect(gate(r, 'sources').ok).toBe(false);
    expect(gate(r, 'sources').reason).toMatch(/private or reserved/);
  });
  it('passes every probe call an abort signal bounded by the remaining budget', async () => {
    const probe = okProbe();
    await runGates(db, article(), play, { probe, now: NOW });
    expect(probe.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
  });
  it('stops checking sources when the overall time budget is spent', async () => {
    const slow = probeOf(async () => { await new Promise((r) => setTimeout(r, 60)); return { status: 200, location: null }; });
    const three = Array.from({ length: 3 }, (_, i) => ({ title: `s${i}`, url: `https://example.org/${i}`, accessedAt: '2026-10-30' }));
    const r = await runGates(db, article({ sources: three }), play, { probe: slow, now: NOW, sourceBudgetMs: 100 });
    expect(gate(r, 'sources').ok).toBe(false);
    expect(gate(r, 'sources').reason).toMatch(/time/i);
    expect(slow.mock.calls.length).toBeLessThan(3);
  });
  it('the schema allows at most 10 sources', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ title: `s${i}`, url: `https://example.org/${i}`, accessedAt: '2026-10-30' }));
    expect(itemSubmissionSchema.safeParse({ ...JSON.parse(JSON.stringify(article())), sources: many }).success).toBe(false);
  });
  it('passes with no sources for a reflective item', async () => {
    const r = await runGates(db, article({ sources: [] }), play, { probe: okProbe(), now: NOW });
    expect(gate(r, 'sources').ok).toBe(true);
  });
});

describe('kids readability and explained answers', () => {
  const easy = 'The sun is hot. We can see it. It helps plants grow. Birds like the sun too.';
  const hard = 'Photosynthesis is the biochemical process through which chlorophyll-containing organisms convert electromagnetic radiation into chemical energy, subsequently synthesizing carbohydrates from atmospheric carbon dioxide and absorbed water.';
  it('a grade-low Kids text passes and a dense Kids text fails', async () => {
    expect(gate(await runGates(db, article({ audience: 'kids', sources: [] }, easy), kids, { probe: okProbe(), now: NOW }), 'kids-readability').ok).toBe(true);
    const bad = await runGates(db, article({ audience: 'kids', sources: [] }, hard), kids, { probe: okProbe(), now: NOW });
    expect(gate(bad, 'kids-readability').ok).toBe(false);
    expect(gate(bad, 'kids-readability').reason).toMatch(/grade/i);
  });
  it('is skipped (passes) for adult-audience content', async () => {
    expect(gate(await runGates(db, article({ sources: [] }, hard), play, { probe: okProbe(), now: NOW }), 'kids-readability').ok).toBe(true);
  });
  it('a quiz without an explanation fails the explained-answer gate', async () => {
    const q = quiz();
    const noExplanation = { ...q, answer: { value: { value: 30, tolerance: 0 }, explanation: '   ' } } as ItemSubmission;
    expect(gate(await runGates(db, noExplanation, play, { probe: okProbe(), now: NOW }), 'explained-answer').ok).toBe(false);
    expect(gate(await runGates(db, q, play, { probe: okProbe(), now: NOW }), 'explained-answer').ok).toBe(true);
  });
});

describe('runGates', () => {
  it('returns every gate result in order and is ok only when all pass', async () => {
    const good = await runGates(db, article(), play, { probe: okProbe(), now: NOW });
    expect(good.results.map((r) => r.gate)).toEqual(['schema', 'duplicate', 'blocked-words', 'blocked-topics', 'sources', 'kids-readability', 'explained-answer']);
    expect(good.ok).toBe(true);
    const bad = await runGates(db, article({ sources: [] }), discover, { probe: okProbe(), now: NOW });
    expect(bad.ok).toBe(false);
    expect(bad.results.filter((r) => !r.ok).map((r) => r.gate)).toEqual(['sources']);
  });
  it('turns a thrown error into a failing result instead of throwing', async () => {
    const r = await runGates(db, article(), play, { probe: probeOf(() => { throw new Error('boom'); }), now: NOW });
    expect(gate(r, 'sources').ok).toBe(false);
    expect(gate(r, 'sources').reason).toMatch(/boom|reach/i);
  });
});
