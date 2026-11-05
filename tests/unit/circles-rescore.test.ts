// @vitest-environment node
// Re-scoring (plan 4C Task 2): the record path keeps the chosen answer for closed mechanics (never free text); changing
// an item's answer key recomputes `correct` from it, leaves older rows without a choice alone, and writes one notice for
// each circle that had the item in a set in the last 30 days.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { adult, childIn, circleOf, fixtures, item, join, type Fixtures } from '../helpers/circle-play';
import { recordAnswer } from '@/lib/accounts/responses';
import { recordPlay } from '@/lib/accounts/record-play';
import { playResult } from '@/lib/play/answer';
import { anonymousScope } from '@/lib/public/scope';
import { changeAnswerKey, listNotices, rescoreItem } from '@/lib/circles/rescore';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let f: Fixtures;
const NOW = new Date('2026-11-05T12:00:00Z');

beforeAll(async () => {
  db = await newTestDb();
  f = await fixtures(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM circles');
  await db.query('DELETE FROM items');
});

const slugOf = async (id: string) => (await db.query<{ slug: string }>('SELECT slug FROM items WHERE id = $1', [id])).rows[0].slug;
const stored = async (accountId: string, itemId: string) =>
  (await db.query<{ correct: boolean; choice: unknown }>('SELECT correct, choice FROM item_responses WHERE account_id = $1 AND item_id = $2', [accountId, itemId])).rows[0];
const inSet = (circleId: string, itemId: string, day: string) =>
  db.query('INSERT INTO circle_daily_sets (circle_id, day, position, item_id) VALUES ($1, $2, 1, $3)', [circleId, day, itemId]);
const notices = async () => (await db.query<{ circle_id: string }>('SELECT circle_id FROM circle_notices ORDER BY id')).rows.map((r) => r.circle_id);

describe('the record path keeps the choice', () => {
  it('stores a multiple-choice pick, and no text for a free-text answer', async () => {
    const who = await adult(db);
    const mc = await item(db, { world: f.worlds.a });
    const text = await item(db, {
      world: f.worlds.a,
      body: { mechanic: 'short_text', prompt: 'Name it' },
      answer: { accepted: ['Paris'] },
    });
    const play = async (id: string, r: string) => {
      const result = await playResult(db, anonymousScope(NOW), 'wa', await slugOf(id), new URLSearchParams({ r }));
      return recordPlay(db, { accountId: who, profileId: null }, result, true, NOW);
    };
    expect(await play(mc, 'b')).toBe('saved');
    expect(await play(text, 'my name is Sam')).toBe('saved');
    expect(await stored(who, mc)).toEqual({ correct: true, choice: 'b' });
    expect(await stored(who, text)).toEqual({ correct: false, choice: null });
  });
});

describe('rescoreItem and changeAnswerKey', () => {
  it('flips correct for stored choices, leaves rows without one, and notifies each recent circle once', async () => {
    const [a, b, old] = [await adult(db), await adult(db), await adult(db)];
    const id = await item(db, { world: f.worlds.a });
    await recordAnswer(db, { accountId: a, profileId: null }, id, true, NOW, 'b');
    await recordAnswer(db, { accountId: b, profileId: null }, id, false, NOW, 'a');
    await recordAnswer(db, { accountId: old, profileId: null }, id, true, NOW);
    const c1 = await circleOf(db, a, { kind: 'friends' });
    const c2 = await circleOf(db, b, { kind: 'friends' });
    const c3 = await circleOf(db, old, { kind: 'friends' });
    await join(db, c1.slug, b);
    await inSet(c1.id, id, '2026-11-05');
    await inSet(c1.id, id, '2026-11-01');
    await inSet(c2.id, id, '2026-11-05');
    await inSet(c3.id, id, '2026-09-20'); // more than 30 days ago

    expect(await db.transaction((tx) => changeAnswerKey(tx, id, 'a', NOW))).toEqual({ changed: 2, circles: 2 });
    expect(await stored(a, id)).toMatchObject({ correct: false });
    expect(await stored(b, id)).toMatchObject({ correct: true });
    expect(await stored(old, id)).toMatchObject({ correct: true, choice: null });
    expect((await notices()).sort()).toEqual([c1.id, c2.id].sort());

    // Nothing changes on a second run: no new notice.
    expect(await db.transaction((tx) => rescoreItem(tx, id, NOW))).toEqual({ changed: 0, circles: 0 });
    expect(await notices()).toHaveLength(2);

    // Members of c1 see its notice; a non-member and a forged slug see nothing.
    expect(await listNotices(db, b, c1.slug, NOW)).toHaveLength(1);
    expect(await listNotices(db, old, c1.slug, NOW)).toBeNull();
    expect(await listNotices(db, a, 'zzzzzzzzzz', NOW)).toBeNull();
    expect(JSON.stringify(await listNotices(db, a, c1.slug, NOW))).not.toMatch(/choice|answer/);
  });

  it('notifies only circles where a current or former member flipped answer counted on a set day (final review 4)', async () => {
    const [ann, bob, cat, dan] = [await adult(db), await adult(db), await adult(db), await adult(db)];
    const id = await item(db, { world: f.worlds.a });
    const adultsItem = await item(db, { world: f.worlds.a, audience: 'adults' });
    for (const who of [ann, bob]) await recordAnswer(db, { accountId: who, profileId: null }, id, true, NOW, 'b');
    await recordAnswer(db, { accountId: ann, profileId: null }, adultsItem, true, NOW, 'b');
    const stranger = await circleOf(db, dan, { kind: 'friends' }); // dan never answered; ann and bob are not members
    const former = await circleOf(db, cat, { kind: 'friends' });
    await join(db, former.slug, bob);
    await db.query('UPDATE circle_members SET left_at = $2 WHERE circle_id = $1 AND account_id = $3', [former.id, NOW.toISOString(), bob]);
    const otherDay = await circleOf(db, ann, { kind: 'friends', name: 'Other day' });
    const family = await circleOf(db, ann, { kind: 'family', name: 'Family' });
    await childIn(db, ann, family.slug, 'Mia');
    for (const c of [stranger, former]) await inSet(c.id, id, '2026-11-05');
    await inSet(otherDay.id, id, '2026-11-03');
    await inSet(family.id, adultsItem, '2026-11-05');

    expect((await db.transaction((tx) => changeAnswerKey(tx, id, 'a', NOW)))!.changed).toBe(2);
    expect(await db.transaction((tx) => changeAnswerKey(tx, adultsItem, 'a', NOW))).toEqual({ changed: 1, circles: 0 });
    expect(await notices()).toEqual([former.id]);
  });

  it('an item without an answer row is not changed', async () => {
    const id = await item(db, { world: f.worlds.a, answer: null });
    expect(await db.transaction((tx) => changeAnswerKey(tx, id, 'a', NOW))).toBeNull();
  });
});
