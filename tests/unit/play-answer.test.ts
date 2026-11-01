// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { playResult } from '@/lib/play/answer';
import { anonymousScope, type Scope } from '@/lib/public/scope';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-01T12:00:00Z');
const anon: Scope = anonymousScope(NOW);
const child: Scope = { audiences: ['kids', 'all'], now: NOW };
const EXPL = 'Because that is the correct answer, explained.';
const body = {
  mechanic: 'multiple_choice',
  prompt: 'Which one is right?',
  options: [
    { id: 'a', text: 'Alpha' },
    { id: 'b', text: 'Beta' },
    { id: 'c', text: 'Gamma' },
    { id: 'd', text: 'Delta' },
  ],
  difficulty: 'easy',
};

type Opts = { world?: string; kind?: string; audience?: string; status?: string; publishedAt?: string };
async function put(slug: string, o: Opts = {}) {
  const w = await db.query<{ id: number }>('SELECT id FROM worlds WHERE slug = $1', [o.world ?? 'play']);
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1,$2,$3,'A title','A summary of the item.',$4::jsonb,$5,$6,$7,'test','computable','test') RETURNING id`,
    [
      w.rows[0].id,
      o.kind ?? 'quiz',
      slug,
      JSON.stringify(body),
      o.audience ?? 'all',
      o.status ?? 'published',
      o.publishedAt ?? '2026-10-31T00:00:00Z',
    ],
  );
  await db.query('INSERT INTO item_answers (item_id, answer, explanation) VALUES ($1, $2::jsonb, $3)', [
    r.rows[0].id,
    JSON.stringify('b'),
    EXPL,
  ]);
}
const p = (o: Record<string, string>) => new URLSearchParams(o);

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  await db.query("INSERT INTO worlds (slug, name, enabled) VALUES ('hidden', 'Hidden', false)");
  await put('good');
  await put('good-game', { kind: 'game' });
  await put('a-draft', { status: 'draft' });
  await put('future', { publishedAt: '2026-12-01T00:00:00Z' });
  await put('an-article', { kind: 'article' });
  await put('a-script', { kind: 'video_script' });
  await put('in-hidden', { world: 'hidden' });
  await put('adults-only', { audience: 'adults' });
});
afterAll(async () => {
  await db.close();
});

describe('playResult', () => {
  it('right and wrong answers return ok with the explanation', async () => {
    expect(await playResult(db, anon, 'play', 'good', p({ r: 'b' }))).toEqual({
      status: 'ok',
      correct: true,
      answerText: 'Beta',
      explanation: EXPL,
    });
    expect(await playResult(db, anon, 'play', 'good', p({ r: 'a' }))).toMatchObject({
      status: 'ok',
      correct: false,
      answerText: 'Beta',
    });
  });
  it('games are checked too', async () => {
    expect(await playResult(db, anon, 'play', 'good-game', p({ r: 'b' }))).toMatchObject({ status: 'ok', correct: true });
  });
  it('not_found for anything not publicly playable', async () => {
    const cases = [
      ['play', 'a-draft'],
      ['play', 'future'],
      ['play', 'an-article'],
      ['play', 'a-script'],
      ['play', 'nope'],
      ['hidden', 'in-hidden'],
    ];
    for (const [w, s] of cases) {
      expect(await playResult(db, anon, w, s, p({ r: 'b' }))).toEqual({ status: 'not_found' });
    }
  });
  it('an adults item is not_found for a child scope', async () => {
    expect(await playResult(db, child, 'play', 'adults-only', p({ r: 'b' }))).toEqual({ status: 'not_found' });
    expect(await playResult(db, anon, 'play', 'adults-only', p({ r: 'b' }))).toMatchObject({ status: 'ok' });
  });
  it('invalid for missing or malformed params', async () => {
    expect(await playResult(db, anon, 'play', 'good', p({}))).toEqual({ status: 'invalid' });
    expect(await playResult(db, anon, 'play', 'good', p({ r: 'x'.repeat(201) }))).toEqual({ status: 'invalid' });
  });
  it('a hidden item is not_found even with missing params', async () => {
    expect(await playResult(db, anon, 'play', 'a-draft', p({}))).toEqual({ status: 'not_found' });
  });
});
