// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { signUp } from '@/lib/accounts/signup';
import { recordAnswer } from '@/lib/accounts/responses';
import {
  createPromo,
  getLivePromo,
  getPublicPromo,
  listLivePromos,
  promoPhase,
  recordEntry,
  setPromoStatus,
  updatePromo,
  type PromoFields,
} from '@/lib/promos/repo';
import { drawWinners, entrantStandings, getDraw, listDraws, monthEnded, runDraw } from '@/lib/promos/draw';

// Promotion records, entries and the recorded draw (lib/promos/repo.ts, lib/promos/draw.ts) against a real
// migrated database: a promotion is data, so its whole lifecycle — create, edit, go live, end — is exercised
// here without any deployment-shaped step.

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
let n = 0;
let worldId = 0;

const fields = (over: Partial<PromoFields> = {}): PromoFields => ({
  slug: 'test-promo',
  type: 'streak_draw',
  title: 'Test promo',
  shortDescription: 'A short description.',
  body: 'How it works.',
  rules: 'The rules.',
  prize: 'Five $25 gift cards',
  startsOn: null,
  endsOn: null,
  config: { targetDays: 10, freezeAllowance: 1, winnersPerDraw: 5 },
  ...over,
});

async function account(): Promise<string> {
  const r = await signUp(db, { email: `p${n++}@example.test`, dateOfBirth: '1990-05-05' }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return r.accountId;
}

async function addQuiz(day: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1,'quiz',$2,'T','S','{}'::jsonb,'all','published',$3,'test','computable','test') RETURNING id`,
    [worldId, `dq-${day}`, `${day}T00:00:00Z`],
  );
  return r.rows[0].id;
}

const DAY = 86_400_000;
const dayStr = (from: string, i: number) => new Date(Date.parse(`${from}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10);

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  worldId = (await db.query<{ id: number }>('SELECT id FROM worlds ORDER BY id LIMIT 1')).rows[0].id;
});

afterAll(async () => {
  await db.close();
});

describe('promotion records', () => {
  it('a draft is not public; going live shows it; ending hides it again', async () => {
    const now = new Date('2026-11-19T12:00:00Z');
    const p = await createPromo(db, fields());
    expect(await getLivePromo(db, 'test-promo', now)).toBeNull();
    // The seeded Spark Streak is legitimately live at this date; the draft must simply not be among the live.
    expect((await listLivePromos(db, now)).map((x) => x.id)).not.toContain(p.id);
    await setPromoStatus(db, p.id, 'live');
    expect((await getLivePromo(db, 'test-promo', now))?.id).toBe(p.id);
    expect((await listLivePromos(db, now)).map((x) => x.id)).toContain(p.id);
    await setPromoStatus(db, p.id, 'ended');
    expect(await getLivePromo(db, 'test-promo', now)).toBeNull();
  });

  it('dates bound visibility: before the start and after the end it is not live', async () => {
    const p = await createPromo(db, fields({ slug: 'dated-promo', startsOn: '2026-12-01', endsOn: '2026-12-31' }));
    await setPromoStatus(db, p.id, 'live');
    expect(await getLivePromo(db, 'dated-promo', new Date('2026-11-19T12:00:00Z'))).toBeNull();
    expect(await getLivePromo(db, 'dated-promo', new Date('2026-12-15T12:00:00Z'))).not.toBeNull();
    expect(await getLivePromo(db, 'dated-promo', new Date('2027-01-05T12:00:00Z'))).toBeNull();
  });

  it('edits are data edits: an update changes what the public read returns', async () => {
    const p = await createPromo(db, fields({ slug: 'edit-promo' }));
    await setPromoStatus(db, p.id, 'live');
    const now = new Date('2026-11-19T12:00:00Z');
    await updatePromo(db, p.id, fields({ slug: 'edit-promo', title: 'A brand new title', prize: 'One $10 gift card' }));
    const after = await getLivePromo(db, 'edit-promo', now);
    expect(after?.title).toBe('A brand new title');
    expect(after?.prize).toBe('One $10 gift card');
  });

  it('the seeded Spark Streak record exists and is a live streak_draw', async () => {
    const seeded = await getLivePromo(db, 'spark-streak', new Date('2026-11-21T12:00:00Z'));
    expect(seeded?.type).toBe('streak_draw');
    expect(seeded?.title).toBe('The 10-Day Spark Streak');
    expect(seeded?.rules).toContain('18 or older');
  });

  it('share fields round-trip as data, and the seeded streak carries its share card', async () => {
    const p = await createPromo(
      db,
      fields({
        slug: 'share-promo',
        shareTitle: 'Share Me',
        shareDescription: 'Shared kindly.',
        shareImage: '/images/promos/share-streak.jpg',
      }),
    );
    expect(p.shareTitle).toBe('Share Me');
    expect(p.shareImage).toBe('/images/promos/share-streak.jpg');
    await setPromoStatus(db, p.id, 'live');
    const live = await getLivePromo(db, 'share-promo', new Date('2026-11-19T12:00:00Z'));
    expect(live?.shareDescription).toBe('Shared kindly.');
    await updatePromo(db, p.id, fields({ slug: 'share-promo', shareTitle: 'Share Me Differently' }));
    expect((await getLivePromo(db, 'share-promo', new Date('2026-11-19T12:00:00Z')))?.shareTitle).toBe(
      'Share Me Differently',
    );
    const seeded = await getLivePromo(db, 'spark-streak', new Date('2026-11-21T12:00:00Z'));
    expect(seeded?.shareImage).toBe('/images/promos/share-streak.jpg');
    expect(seeded?.shareTitle).toContain('gift cards');
  });

  it('public phases: drafts and upcoming promos are not public; ended ones keep a page', async () => {
    const now = new Date('2026-11-19T12:00:00Z');
    const draft = await createPromo(db, fields({ slug: 'phase-draft' }));
    expect(promoPhase(draft, now)).toBe('draft');
    expect(await getPublicPromo(db, 'phase-draft', now)).toBeNull();

    const future = await createPromo(db, fields({ slug: 'phase-future', startsOn: '2026-12-01' }));
    await setPromoStatus(db, future.id, 'live');
    expect(promoPhase({ ...future, status: 'live' }, now)).toBe('upcoming');
    expect(await getPublicPromo(db, 'phase-future', now)).toBeNull();

    const ended = await createPromo(db, fields({ slug: 'phase-ended' }));
    await setPromoStatus(db, ended.id, 'ended');
    expect((await getPublicPromo(db, 'phase-ended', now))?.phase).toBe('ended');
    // …but an ended promo is never enterable-live.
    expect(await getLivePromo(db, 'phase-ended', now)).toBeNull();

    const past = await createPromo(db, fields({ slug: 'phase-past', endsOn: '2026-11-10' }));
    await setPromoStatus(db, past.id, 'live');
    expect((await getPublicPromo(db, 'phase-past', now))?.phase).toBe('ended');

    const live = await createPromo(db, fields({ slug: 'phase-live' }));
    await setPromoStatus(db, live.id, 'live');
    expect((await getPublicPromo(db, 'phase-live', now))?.phase).toBe('live');
  });
});

describe('entries and the draw', () => {
  it('an entry is recorded once; a repeat is not a second entry', async () => {
    const p = await createPromo(db, fields({ slug: 'entry-promo' }));
    const me = await account();
    expect(await recordEntry(db, p.id, me, true)).toBe(true);
    expect(await recordEntry(db, p.id, me, true)).toBe(false);
  });

  it('drawWinners is a pure function of (pool, seed, count)', () => {
    const pool = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'];
    const w = drawWinners(pool, 'seed-123', 5);
    expect(w).toHaveLength(5);
    expect(new Set(w).size).toBe(5);
    expect(drawWinners([...pool].reverse(), 'seed-123', 5)).toEqual(w); // input order does not matter
    expect(drawWinners(pool, 'seed-123', 5)).toEqual(w); // same seed, same winners
    expect(drawWinners(pool, 'seed-123', 50)).toHaveLength(7); // never more than the pool
  });

  it('the pool is entrants who completed that month; the draw records itself and refuses a redraw', async () => {
    const promo = await createPromo(db, fields({ slug: 'draw-promo' }));
    const quizzes: string[] = [];
    for (let i = 0; i < 10; i++) quizzes.push(await addQuiz(dayStr('2026-11-02', i)));
    const finisher = await account();
    const dabbler = await account();
    const outsider = await account();
    for (let i = 0; i < 10; i++) {
      await recordAnswer(db, { accountId: finisher, profileId: null }, quizzes[i], true, new Date(`${dayStr('2026-11-02', i)}T12:00:00Z`));
      await recordAnswer(db, { accountId: outsider, profileId: null }, quizzes[i], true, new Date(`${dayStr('2026-11-02', i)}T12:00:00Z`));
    }
    for (let i = 0; i < 3; i++) {
      await recordAnswer(db, { accountId: dabbler, profileId: null }, quizzes[i], true, new Date(`${dayStr('2026-11-02', i)}T12:00:00Z`));
    }
    await recordEntry(db, promo.id, finisher, true);
    await recordEntry(db, promo.id, dabbler, true);
    // The outsider completed but never entered, so they are not in the pool.
    const now = new Date('2026-12-01T09:00:00Z');
    const standings = await entrantStandings(db, promo, '2026-11', now);
    expect(standings.find((s) => s.accountId === finisher)?.completedInMonth).toBe(true);
    expect(standings.find((s) => s.accountId === dabbler)?.completedInMonth).toBe(false);
    expect(standings.map((s) => s.accountId)).not.toContain(outsider);

    const drawn = await db.transaction((tx) => runDraw(tx, promo, '2026-11', 'owner@example.test', now));
    expect(drawn.ok).toBe(true);
    if (drawn.ok) {
      expect(drawn.draw.poolSize).toBe(1);
      expect(drawn.draw.winners).toEqual([finisher]);
      expect(drawn.draw.seed).toMatch(/^[0-9a-f]{48}$/);
      expect(drawn.draw.method).toContain('mulberry32');
      expect(drawn.draw.drawnBy).toBe('owner@example.test');
      // The pool itself is recorded with the draw, so the winners stay recomputable from the record alone.
      expect(drawn.draw.poolIds).toEqual([finisher]);
      expect(drawWinners(drawn.draw.poolIds, drawn.draw.seed, 5)).toEqual(drawn.draw.winners);
    }
    expect((await listDraws(db, promo.id)).map((d) => d.month)).toEqual(['2026-11']);
    expect((await getDraw(db, promo.id, '2026-11'))?.winners).toEqual([finisher]);

    const again = await db.transaction((tx) => runDraw(tx, promo, '2026-11', 'owner@example.test', now));
    expect(again).toEqual({ ok: false, code: 'already_drawn' });
    const empty = await db.transaction((tx) => runDraw(tx, promo, '2026-10', 'owner@example.test', now));
    expect(empty).toEqual({ ok: false, code: 'empty_pool' });
  });

  it('a month can be drawn only once it has ended — site-day aware, so not before 06:00 UTC on the 1st', () => {
    expect(monthEnded('2026-11', new Date('2026-11-30T23:59:00Z'))).toBe(false);
    // Midnight on the 1st is still Nov 30's site-day (it runs to 06:00 UTC): not drawable yet.
    expect(monthEnded('2026-11', new Date('2026-12-01T00:00:00Z'))).toBe(false);
    expect(monthEnded('2026-11', new Date('2026-12-01T05:59:00Z'))).toBe(false);
    expect(monthEnded('2026-11', new Date('2026-12-01T06:00:00Z'))).toBe(true);
    expect(monthEnded('2026-12', new Date('2026-11-30T12:00:00Z'))).toBe(false);
    expect(monthEnded('2026-10', new Date('2026-11-01T06:00:00Z'))).toBe(true);
  });
});
