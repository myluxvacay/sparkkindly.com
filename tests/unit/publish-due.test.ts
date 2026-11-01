// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createItem, getItem, ApprovalRequiredError, type Status } from '@/lib/items/repo';
import { publishDue } from '@/lib/jobs/publish-due';
import { runJob } from '@/lib/jobs/run-job';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let playId: number;
let growId: number;
let kidsId: number;
let n = 0;
const NOW = new Date('2026-11-05T12:00:00Z');
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const w = (await db.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds')).rows;
  playId = w.find((x) => x.slug === 'play')!.id;
  growId = w.find((x) => x.slug === 'grow')!.id;
  kidsId = w.find((x) => x.slug === 'kids')!.id;
});
afterAll(async () => {
  await db.close();
});

const make = (status: Status, publishAt: Date | null, worldId = playId, approvedBy?: string) =>
  createItem(db, { worldId, kind: 'article', slug: `job-${++n}`, title: 't', summary: 'A summary', body: {}, audience: 'all', createdBy: 't', riskTier: 'reflective', status, publishAt, approvedBy });
const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0].n);

describe('publishDue', () => {
  it('publishes only scheduled items whose time has come', async () => {
    const due = await make('scheduled', at('2026-11-05T06:00:00Z'));
    const later = await make('scheduled', at('2026-11-06T06:00:00Z'));
    const draft = await make('draft', at('2026-11-01T06:00:00Z'));
    const result = await publishDue(db, NOW);
    expect(result.published).toContain(due.id);
    expect(result.published).not.toContain(later.id);
    expect(result.published).not.toContain(draft.id);
    expect((await getItem(db, due.id))?.status).toBe('published');
    expect((await getItem(db, later.id))?.status).toBe('scheduled');
    expect((await getItem(db, draft.id))?.status).toBe('draft');
  });

  it('publishes a due item once even when called twice', async () => {
    const item = await make('scheduled', at('2026-11-05T05:00:00Z'));
    const first = await publishDue(db, NOW);
    const second = await publishDue(db, NOW);
    expect(first.published).toContain(item.id);
    expect(second.published).not.toContain(item.id);
    expect(await count("SELECT count(*) n FROM events WHERE name = 'item_published' AND meta->>'item' = $1", [item.id])).toBe(1);
  });

  it('two simultaneous calls never publish the same item twice', async () => {
    const items = await Promise.all([1, 2, 3].map(() => make('scheduled', at('2026-11-05T04:00:00Z'))));
    const [a, b] = await Promise.all([publishDue(db, NOW), publishDue(db, NOW)]);
    const all = [...a.published, ...b.published];
    for (const i of items) expect(all.filter((id) => id === i.id)).toHaveLength(1);
    for (const i of items) expect(await count("SELECT count(*) n FROM events WHERE name = 'item_published' AND meta->>'item' = $1", [i.id])).toBe(1);
  });

  it('records the publish time on first publish', async () => {
    const item = await make('scheduled', at('2026-11-05T03:00:00Z'));
    await publishDue(db, NOW);
    expect((await getItem(db, item.id))?.publishedAt).toBeInstanceOf(Date);
  });

  it('cannot find an unapproved Kids item to publish because the database never lets one be scheduled', async () => {
    await expect(createItem(db, { worldId: kidsId, kind: 'article', slug: `k-${++n}`, title: 't', summary: 'A summary', body: {}, audience: 'kids', createdBy: 't', riskTier: 'kids', status: 'scheduled', publishAt: at('2026-11-05T01:00:00Z') }))
      .rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(await count("SELECT count(*) n FROM items WHERE audience = 'kids' AND status = 'scheduled' AND approved_by IS NULL")).toBe(0);
  });

  it('sends an item back to review when its world went into review mode after it was scheduled, and keeps going', async () => {
    const stranded = await make('scheduled', at('2026-11-05T02:00:00Z'), growId);
    const fine = await make('scheduled', at('2026-11-05T02:30:00Z'), playId);
    await db.query("UPDATE worlds SET approval_mode = 'review' WHERE id = $1", [growId]);
    const result = await publishDue(db, NOW);
    expect(result.held).toContain(stranded.id);
    expect((await getItem(db, stranded.id))?.status).toBe('in_review');
    expect(result.published).toContain(fine.id);
    await db.query("UPDATE worlds SET approval_mode = 'auto' WHERE id = $1", [growId]);
  });

  it('publishes a scheduled item in a review-mode world if it was approved', async () => {
    await db.query("UPDATE worlds SET approval_mode = 'review' WHERE id = $1", [growId]);
    const approved = await make('scheduled', at('2026-11-05T02:10:00Z'), growId, 'owner');
    const result = await publishDue(db, NOW);
    expect(result.published).toContain(approved.id);
    await db.query("UPDATE worlds SET approval_mode = 'auto' WHERE id = $1", [growId]);
  });

  it('does nothing when nothing is due', async () => {
    expect(await publishDue(db, new Date('2020-01-01T00:00:00Z'))).toEqual({ published: [], held: [] });
  });
});

describe('runJob', () => {
  const failures = () => count('SELECT count(*) n FROM failed_jobs');

  it('retries and then succeeds without recording a failure', async () => {
    let calls = 0;
    const before = await failures();
    await runJob(db, 'flaky', async () => { if (++calls < 3) throw new Error('not yet'); }, { attempts: 3, delayMs: 0 });
    expect(calls).toBe(3);
    expect(await failures()).toBe(before);
  });

  it('records a failed_jobs row after the last failure and does not throw', async () => {
    const before = await failures();
    await expect(runJob(db, 'always-fails', async () => { throw new Error('database is down'); }, { attempts: 3, delayMs: 0 })).resolves.toBeUndefined();
    expect(await failures()).toBe(before + 1);
    const row = (await db.query<{ job: string; error: string; attempts: number }>("SELECT job, error, attempts FROM failed_jobs WHERE job = 'always-fails'")).rows[0];
    expect(row).toEqual({ job: 'always-fails', error: 'database is down', attempts: 3 });
  });

  it('keeps stack traces out of failed_jobs', async () => {
    await runJob(db, 'with-stack', async () => { throw new Error('boom'); }, { attempts: 1, delayMs: 0 });
    const row = (await db.query<{ error: string }>("SELECT error FROM failed_jobs WHERE job = 'with-stack'")).rows[0];
    expect(row.error).toBe('boom');
    expect(row.error).not.toMatch(/\n\s+at /);
  });

  it('waits longer between each retry', async () => {
    vi.useFakeTimers();
    try {
      const calls: number[] = [];
      const p = runJob(db, 'timed', async () => { calls.push(Date.now()); throw new Error('x'); }, { attempts: 3, delayMs: 100 });
      await vi.advanceTimersByTimeAsync(1000);
      await p;
      expect(calls).toHaveLength(3);
      expect(calls[1] - calls[0]).toBe(100);
      expect(calls[2] - calls[1]).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives being unable to write the failure row', async () => {
    const broken = { ...db, query: async () => { throw new Error('db gone'); } } as unknown as TestDb;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runJob(broken, 'x', async () => { throw new Error('y'); }, { attempts: 1, delayMs: 0 })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
