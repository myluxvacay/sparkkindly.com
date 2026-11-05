// @vitest-environment node
// The closed-circle purge (plan 4A Task 2): circles closed more than 30 days ago are deleted with their rows.
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { claimCirclesPurge, purgeClosedCircles } from '@/lib/jobs/circles-purge';
import { tick } from '@/worker/main';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-12-15T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const atNow = { dbNow: async () => NOW };
let owner = '';

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM circles');
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM job_runs');
  await db.query('DELETE FROM failed_jobs');
  const r = await signUp(db, { email: 'purge@example.test', dateOfBirth: '1990-01-01' }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  owner = r.accountId;
});

async function circle(closedDaysAgo: number | null) {
  const r = await db.query<{ id: string }>(
    `INSERT INTO circles (slug, name, kind, owner_account_id, status, closed_at)
     VALUES (substr(md5(random()::text), 1, 10), 'C', 'friends', $1, $2, $3) RETURNING id`,
    [owner, closedDaysAgo === null ? 'open' : 'closed', closedDaysAgo === null ? null : ago(closedDaysAgo)],
  );
  await db.query("INSERT INTO circle_members (circle_id, account_id, role, display_name) VALUES ($1, $2, 'owner', 'O')", [
    r.rows[0].id,
    owner,
  ]);
  return r.rows[0].id;
}
const ids = async () => (await db.query<{ id: string }>('SELECT id FROM circles ORDER BY id')).rows.map((r) => r.id).sort();

describe('purgeClosedCircles', () => {
  it('deletes only circles closed over 30 days ago, with their members, and leaves open and recent ones', async () => {
    const open = await circle(null);
    const recent = await circle(29);
    const old = await circle(31);
    expect(await purgeClosedCircles(db, NOW, 100, atNow)).toBe(1);
    expect(await ids()).toEqual([open, recent].sort());
    expect((await db.query('SELECT 1 FROM circle_members WHERE circle_id = $1', [old])).rows).toHaveLength(0);
    expect(await purgeClosedCircles(db, NOW, 100, atNow)).toBe(0);
  });

  it('respects the cap and alerts when more are due', async () => {
    for (let i = 0; i < 3; i++) await circle(40 + i);
    expect(await purgeClosedCircles(db, NOW, 2, atNow)).toBe(2);
    expect(await ids()).toHaveLength(1);
    expect((await db.query("SELECT 1 FROM failed_jobs WHERE job = 'circles-purge'")).rows).toHaveLength(1);
  });

  it('refuses when the worker and database clocks differ by more than 10 minutes', async () => {
    await circle(40);
    expect(await purgeClosedCircles(db, NOW, 100, { dbNow: async () => new Date(NOW.getTime() + 11 * 60_000) })).toBe(0);
    expect(await ids()).toHaveLength(1);
  });

  it('is claimed once per UTC day and runs from the worker tick', async () => {
    await circle(40);
    expect(await claimCirclesPurge(db, NOW)).toBe(true);
    expect(await claimCirclesPurge(db, NOW)).toBe(false);
    await db.query('DELETE FROM job_runs');
    const send = async () => {};
    const log = await tick(db, NOW, {}, send, { delayMs: 0, dbNow: async () => NOW });
    expect(log.join(';')).toMatch(/circles purge: 1 deleted/);
    expect(await ids()).toEqual([]);
    expect((await tick(db, NOW, {}, send, { delayMs: 0, dbNow: async () => NOW })).join(';')).toMatch(/circles purge: done today/);
  });
});
