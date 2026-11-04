// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { signUp } from '@/lib/accounts/signup';
import { deleteAccount } from '@/lib/accounts/delete';
import { createChildProfile, deleteChildProfile } from '@/lib/accounts/children';
import { countAnswered, listAnswered, recordAnswer } from '@/lib/accounts/responses';
import type { Owner } from '@/lib/accounts/interests';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const T1 = new Date('2026-11-02T08:00:00Z');
let n = 0;
const items: string[] = [];

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const w = (await db.query<{ id: number }>('SELECT id FROM worlds ORDER BY id LIMIT 1')).rows[0].id;
  for (const slug of ['one', 'two', 'three']) {
    const r = await db.query<{ id: string }>(
      `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
       VALUES ($1,'quiz',$2,'T','S',$3::jsonb,'all','published','2026-10-31T00:00:00Z','test','computable','test') RETURNING id`,
      [w, slug, JSON.stringify({})],
    );
    items.push(r.rows[0].id);
  }
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
const rows = async () => (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM item_responses')).rows[0].n;
const page = { limit: 10, offset: 0 };

describe('recordAnswer', () => {
  it('stores the first answer and ignores the second, correctness unchanged', async () => {
    const o: Owner = { accountId: await adult(), profileId: null };
    expect(await recordAnswer(db, o, items[0], false, T0)).toBe(true);
    expect(await recordAnswer(db, o, items[0], true, T1)).toBe(false);
    expect(await listAnswered(db, o, page)).toEqual([{ itemId: items[0], correct: false, answeredAt: T0 }]);
    expect(await rows()).toBe(1);
  });

  it('holder and each child profile answer the same item independently', async () => {
    const acc = await adult();
    const kid = await child(acc);
    expect(await recordAnswer(db, { accountId: acc, profileId: null }, items[0], true, T0)).toBe(true);
    expect(await recordAnswer(db, { accountId: acc, profileId: kid }, items[0], false, T0)).toBe(true);
    expect(await countAnswered(db, { accountId: acc, profileId: null })).toEqual({ total: 1, correct: 1 });
    expect(await countAnswered(db, { accountId: acc, profileId: kid })).toEqual({ total: 1, correct: 0 });
  });

  it('refuses a foreign profile id, a bad id and an unknown item without writing', async () => {
    const a = await adult();
    const kidOfB = await child(await adult());
    expect(await recordAnswer(db, { accountId: a, profileId: kidOfB }, items[0], true, T0)).toBe(false);
    expect(await recordAnswer(db, { accountId: 'nope', profileId: null }, items[0], true, T0)).toBe(false);
    expect(await recordAnswer(db, { accountId: a, profileId: 'nope' }, items[0], true, T0)).toBe(false);
    expect(await recordAnswer(db, { accountId: a, profileId: null }, 'nope', true, T0)).toBe(false);
    expect(await recordAnswer(db, { accountId: a, profileId: null }, crypto.randomUUID(), true, T0)).toBe(false);
    expect(await rows()).toBe(0);
  });

  it('the composite foreign key refuses another account profile even when written directly', async () => {
    const a = await adult();
    const kidOfB = await child(await adult());
    await expect(
      db.query(
        'INSERT INTO item_responses (account_id, profile_id, item_id, correct, answered_at) VALUES ($1,$2,$3,true,now())',
        [a, kidOfB, items[0]],
      ),
    ).rejects.toThrow();
  });
});

describe('listAnswered / countAnswered', () => {
  it('lists newest first, pages, and counts only that profile', async () => {
    const acc = await adult();
    const kid = await child(acc);
    const o: Owner = { accountId: acc, profileId: null };
    await recordAnswer(db, o, items[0], true, new Date('2026-11-01T01:00:00Z'));
    await recordAnswer(db, o, items[1], false, new Date('2026-11-01T03:00:00Z'));
    await recordAnswer(db, o, items[2], true, new Date('2026-11-01T02:00:00Z'));
    await recordAnswer(db, { accountId: acc, profileId: kid }, items[0], true, T0);
    expect((await listAnswered(db, o, page)).map((r) => r.itemId)).toEqual([items[1], items[2], items[0]]);
    expect((await listAnswered(db, o, { limit: 1, offset: 1 })).map((r) => r.itemId)).toEqual([items[2]]);
    expect(await countAnswered(db, o)).toEqual({ total: 3, correct: 2 });
    expect(await listAnswered(db, { accountId: acc, profileId: 'nope' }, page)).toEqual([]);
    expect(await countAnswered(db, { accountId: acc, profileId: 'nope' })).toEqual({ total: 0, correct: 0 });
  });

  it('never shows another account its rows', async () => {
    const a = await adult();
    const b = await adult();
    await recordAnswer(db, { accountId: a, profileId: null }, items[0], true, T0);
    expect(await listAnswered(db, { accountId: b, profileId: null }, page)).toEqual([]);
  });
});

describe('deletion', () => {
  it('deleting a child profile removes its responses only; deleting the account removes everything', async () => {
    const acc = await adult();
    const kid = await child(acc);
    await recordAnswer(db, { accountId: acc, profileId: null }, items[0], true, T0);
    await recordAnswer(db, { accountId: acc, profileId: kid }, items[0], true, T0);
    expect(await deleteChildProfile(db, acc, kid)).toBe(true);
    expect(await rows()).toBe(1);
    await deleteAccount(db, acc);
    expect(await rows()).toBe(0);
  });
});
