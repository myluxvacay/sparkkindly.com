// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { signUp } from '@/lib/accounts/signup';
import { deleteAccount } from '@/lib/accounts/delete';
import { createChildProfile, deleteChildProfile } from '@/lib/accounts/children';
import { getInterests, setInterests, type Owner } from '@/lib/accounts/interests';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
let n = 0;
let topics: number[] = [];
let worlds: number[] = [];

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  for (let i = 0; i < 31; i++) {
    await db.query('INSERT INTO topics (slug, name) VALUES ($1, $1)', [`cap-test-${i}`]);
  }
  topics = (await db.query<{ id: number }>('SELECT id FROM topics ORDER BY id')).rows.map((r) => r.id);
  worlds = (await db.query<{ id: number }>('SELECT id FROM worlds ORDER BY id')).rows.map((r) => r.id);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM accounts');
});

async function adult(): Promise<string> {
  const r = await signUp(db, { email: `a${n++}@example.test`, dateOfBirth: '1990-05-05' }, T0);
  if (r.status !== 'created') {
    throw new Error('sign-up failed');
  }
  return r.accountId;
}
async function child(accountId: string): Promise<string> {
  const r = await createChildProfile(
    db,
    accountId,
    {
      displayName: 'Mia',
      ageBand: '6-9',
      guardianConfirmed: true,
      pin: '1234',
    },
    T0,
  );
  if (r.status !== 'created') {
    throw new Error('profile failed');
  }
  return r.profileId;
}
const rows = async () => (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM profile_interests')).rows[0].n;
const sorted = (v: number[]) => [...v].sort((a, b) => a - b);

describe('setInterests / getInterests', () => {
  it('refuses a disabled world, as the interests page never offers one', async () => {
    const o: Owner = { accountId: await adult(), profileId: null };
    const off = (
      await db.query<{ id: number }>("INSERT INTO worlds (slug, name, enabled) VALUES ($1, 'Off', false) RETURNING id", [`off-${n++}`])
    ).rows[0].id;
    expect(await setInterests(db, o, { topicIds: [], worldIds: [off] })).toBe('invalid');
    expect(await rows()).toBe(0);
  });

  it('starts empty and replaces everything on each save', async () => {
    const o: Owner = { accountId: await adult(), profileId: null };
    expect(await getInterests(db, o)).toEqual({ topicIds: [], worldIds: [] });
    expect(
      await setInterests(db, o, {
        topicIds: [topics[0], topics[1]],
        worldIds: [worlds[0]],
      }),
    ).toBe('ok');
    const first = await getInterests(db, o);
    expect(sorted(first.topicIds)).toEqual([topics[0], topics[1]]);
    expect(first.worldIds).toEqual([worlds[0]]);
    expect(await setInterests(db, o, { topicIds: [topics[2]], worldIds: [] })).toBe('ok');
    expect(await getInterests(db, o)).toEqual({
      topicIds: [topics[2]],
      worldIds: [],
    });
    expect(await setInterests(db, o, { topicIds: [], worldIds: [] })).toBe('ok');
    expect(await rows()).toBe(0);
  });

  it('two concurrent saves for the same owner do not throw and leave one consistent set', async () => {
    const o: Owner = { accountId: await adult(), profileId: null };
    const [x, y] = await Promise.all([
      setInterests(db, o, { topicIds: [topics[0]], worldIds: [worlds[0]] }),
      setInterests(db, o, { topicIds: [topics[1]], worldIds: [worlds[0]] }),
    ]);
    expect([x, y]).toEqual(['ok', 'ok']);
    expect(await rows()).toBe(2);
  });

  it('keeps the holder and each child profile separate', async () => {
    const acc = await adult();
    const kid = await child(acc);
    await setInterests(db, { accountId: acc, profileId: null }, { topicIds: [topics[0]], worldIds: [] });
    await setInterests(db, { accountId: acc, profileId: kid }, { topicIds: [topics[1]], worldIds: [worlds[0]] });
    expect((await getInterests(db, { accountId: acc, profileId: null })).topicIds).toEqual([topics[0]]);
    expect(await getInterests(db, { accountId: acc, profileId: kid })).toEqual({
      topicIds: [topics[1]],
      worldIds: [worlds[0]],
    });
    await setInterests(db, { accountId: acc, profileId: null }, { topicIds: [], worldIds: [] });
    expect((await getInterests(db, { accountId: acc, profileId: kid })).topicIds).toEqual([topics[1]]);
  });

  it.each([
    ['unknown topic id', { topicIds: [999999], worldIds: [] }],
    ['unknown world id', { topicIds: [], worldIds: [999999] }],
    ['string ids', { topicIds: ['1'], worldIds: [] }],
    ['float ids', { topicIds: [1.5], worldIds: [] }],
    ['not arrays', { topicIds: 'x', worldIds: null }],
    ['duplicates', { topicIds: [1, 1], worldIds: [] }],
    ['zero or negative', { topicIds: [0, -1], worldIds: [] }],
  ])('rejects %s and keeps the previous set', async (_name, input) => {
    const o: Owner = { accountId: await adult(), profileId: null };
    await setInterests(db, o, { topicIds: [topics[0]], worldIds: [] });
    expect(await setInterests(db, o, input)).toBe('invalid');
    expect(await getInterests(db, o)).toEqual({
      topicIds: [topics[0]],
      worldIds: [],
    });
  });

  it('allows 30 in total and rejects 31, counting topics and worlds together', async () => {
    const o: Owner = { accountId: await adult(), profileId: null };
    expect(
      await setInterests(db, o, {
        topicIds: topics.slice(0, 31),
        worldIds: [],
      }),
    ).toBe('invalid');
    expect(
      await setInterests(db, o, {
        topicIds: topics.slice(0, 30),
        worldIds: [worlds[0]],
      }),
    ).toBe('invalid');
    expect(await rows()).toBe(0);
    expect(
      await setInterests(db, o, {
        topicIds: topics.slice(0, 29),
        worldIds: [worlds[0]],
      }),
    ).toBe('ok');
    expect(await rows()).toBe(30);
  });

  it('rejects a malformed account id or a foreign profile id and never writes or reads it', async () => {
    const a = await adult();
    const b = await adult();
    const kidOfB = await child(b);
    const foreign: Owner = { accountId: a, profileId: kidOfB };
    expect(await setInterests(db, foreign, { topicIds: [topics[0]], worldIds: [] })).toBe('invalid');
    expect(await rows()).toBe(0);
    await setInterests(db, { accountId: b, profileId: kidOfB }, { topicIds: [topics[0]], worldIds: [] });
    expect(await getInterests(db, foreign)).toEqual({
      topicIds: [],
      worldIds: [],
    });
    expect(await setInterests(db, { accountId: 'nope', profileId: null }, { topicIds: [], worldIds: [] })).toBe(
      'invalid',
    );
    expect(await getInterests(db, { accountId: a, profileId: 'nope' })).toEqual({ topicIds: [], worldIds: [] });
  });

  it('the composite foreign key refuses another account profile even when written directly', async () => {
    const a = await adult();
    const kidOfB = await child(await adult());
    await expect(
      db.query('INSERT INTO profile_interests (account_id, profile_id, topic_id) VALUES ($1, $2, $3)', [
        a,
        kidOfB,
        topics[0],
      ]),
    ).rejects.toThrow();
  });

  it('the database refuses duplicates (also for the holder, whose profile id is NULL) and malformed rows', async () => {
    const a = await adult();
    const ins = (t: number | null, w: number | null) =>
      db.query('INSERT INTO profile_interests (account_id, topic_id, world_id) VALUES ($1, $2, $3)', [a, t, w]);
    await ins(topics[0], null);
    await expect(ins(topics[0], null)).rejects.toThrow();
    await ins(null, worlds[0]);
    await expect(ins(null, worlds[0])).rejects.toThrow();
    await expect(ins(topics[1], worlds[1])).rejects.toThrow();
    await expect(ins(null, null)).rejects.toThrow();
  });

  it('deleting a child profile removes its interests only; deleting the account removes everything', async () => {
    const acc = await adult();
    const kid = await child(acc);
    await setInterests(db, { accountId: acc, profileId: null }, { topicIds: [topics[0]], worldIds: [] });
    await setInterests(db, { accountId: acc, profileId: kid }, { topicIds: [topics[1]], worldIds: [worlds[0]] });
    expect(await deleteChildProfile(db, acc, kid)).toBe(true);
    expect(await rows()).toBe(1);
    await deleteAccount(db, acc);
    expect(await rows()).toBe(0);
  });
});
