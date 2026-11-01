// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createItem, type NewItem } from '@/lib/items/repo';
import { buildDigest, renderDigest, sendDigestIfDue } from '@/lib/admin/digest';
import { tick } from '@/worker/main';
import type { EmailMessage } from '@/lib/email';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let playId: number;
let kidsId: number;
let n = 0;
const NOW = new Date('2026-11-05T08:00:00Z');
const env = { ADMIN_EMAILS: 'owner@example.test,second@example.test' };
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const w = (await db.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds')).rows;
  playId = w.find((x) => x.slug === 'play')!.id;
  kidsId = w.find((x) => x.slug === 'kids')!.id;
});
afterAll(async () => {
  await db.close();
});

const make = (over: Partial<NewItem> = {}) =>
  createItem(db, {
    worldId: playId, kind: 'article', slug: `d-${++n}`, title: `Title ${n}`, summary: 'A summary', body: {},
    audience: 'all', createdBy: 'test', riskTier: 'reflective', ...over,
  });
const publishedAt = (id: string, at: Date) => db.query("UPDATE items SET status = 'published', published_at = $2, approved_by = 'x' WHERE id = $1", [id, at.toISOString()]);

describe('buildDigest', () => {
  it('lists what was published in the last 24 hours, what waits, held drafts, failures and buffer days', async () => {
    const fresh = await make({ title: 'Fresh item' });
    await publishedAt(fresh.id, hoursAgo(3));
    const old = await make({ title: 'Old item' });
    await publishedAt(old.id, hoursAgo(30));
    const kid = await make({ worldId: kidsId, audience: 'kids', riskTier: 'kids', status: 'in_review', title: 'Waiting kids item' });
    await db.query('UPDATE items SET created_at = $2 WHERE id = $1', [kid.id, hoursAgo(60).toISOString()]);
    const held = await make({ status: 'draft', title: 'Held draft', qualityReport: { decision: 'quality gates failed; see the quality report' } });
    await db.query('UPDATE items SET created_at = $2 WHERE id = $1', [held.id, hoursAgo(1).toISOString()]);
    await make({ status: 'scheduled', publishAt: new Date('2026-11-06T06:00:00Z'), approvedBy: 'x' });
    await make({ status: 'scheduled', publishAt: new Date('2026-11-07T06:00:00Z'), approvedBy: 'x' });
    await db.query("INSERT INTO failed_jobs (job, error, at) VALUES ('publish-due', 'database is down', $1)", [hoursAgo(2).toISOString()]);
    await db.query("INSERT INTO problem_reports (item_id, reason) VALUES ($1, 'wrong')", [fresh.id]);

    const d = await buildDigest(db, NOW);
    expect(d.day).toBe('2026-11-05');
    expect(d.published.map((p) => p.title)).toEqual(['Fresh item']);
    expect(d.waiting.map((w) => w.title)).toContain('Waiting kids item');
    expect(d.heldByGates.map((h) => h.title)).toContain('Held draft');
    expect(d.failedJobs).toEqual([expect.objectContaining({ job: 'publish-due', error: 'database is down' })]);
    expect(d.buffer.find((b) => b.world === 'play')?.days).toBe(2);
    expect(d.buffer.find((b) => b.world === 'discover')?.days).toBe(0);
    expect(d.openReports).toBe(1);
    expect(d.alerts.join(' ')).toMatch(/Kids item has waited more than 48 hours/);
    expect(d.alerts.join(' ')).toMatch(/less than one day of buffer: .*discover/i);
    expect(d.alerts.join(' ')).toMatch(/1 job failed/);
    expect(d.alerts.join(' ')).toMatch(/No agent has run in 3 days/);
  });
});

describe('renderDigest', () => {
  it('is plain text naming each section, and treats titles as data', async () => {
    const d = await buildDigest(db, NOW);
    d.published.push({ title: '<script>alert(1)</script>', world: 'play' });
    const { subject, text } = renderDigest(d);
    expect(subject).toBe('SparkKindly digest for 2026-11-05: 2 published, 1 waiting, 4 alerts');
    for (const heading of ['Published', 'Waiting for approval', 'Held by the quality gates', 'Failed jobs', 'Buffer', 'Alerts']) {
      expect(text).toContain(heading);
    }
    expect(text).toContain('<script>alert(1)</script>');
    expect(text).not.toMatch(/explanation/i);
  });
});

describe('sendDigestIfDue', () => {
  it('waits for the digest hour, sends once a day to every admin address, and needs recipients', async () => {
    const sent: EmailMessage[] = [];
    const send = async (m: EmailMessage) => { sent.push(m); };
    const day = new Date('2026-11-10T06:30:00Z');
    expect(await sendDigestIfDue(db, day, env, send)).toBe('not_due');
    const at7 = new Date('2026-11-10T07:05:00Z');
    expect(await sendDigestIfDue(db, at7, env, send)).toBe('sent');
    expect(await sendDigestIfDue(db, new Date('2026-11-10T19:00:00Z'), env, send)).toBe('already_sent');
    expect(sent.map((m) => m.to)).toEqual(['owner@example.test', 'second@example.test']);
    expect(await sendDigestIfDue(db, new Date('2026-11-11T09:00:00Z'), { ADMIN_EMAILS: '' }, send)).toBe('no_recipients');
    expect(await sendDigestIfDue(db, new Date('2026-11-12T05:00:00Z'), { ...env, DIGEST_HOUR_UTC: '4' }, send)).toBe('sent');
  });
});

describe('worker tick', () => {
  it('publishes a due item and records a failed digest once without resending it that day', async () => {
    const due = await make({ status: 'scheduled', publishAt: new Date('2026-11-20T06:00:00Z'), approvedBy: 'x' });
    const failing = vi.fn(async () => { throw new Error('MailerSend rejected the message with status 500'); });
    const at = new Date('2026-11-20T08:00:00Z');
    await tick(db, at, env, failing, { delayMs: 0 });
    expect((await db.query('SELECT status FROM items WHERE id = $1', [due.id])).rows[0]).toEqual({ status: 'published' });
    const failures = await db.query<{ job: string }>("SELECT job FROM failed_jobs WHERE job = 'digest'");
    expect(failures.rows).toHaveLength(1);
    const calls = failing.mock.calls.length;
    await tick(db, new Date('2026-11-20T08:01:00Z'), env, failing, { delayMs: 0 });
    expect(failing.mock.calls.length).toBe(calls);
    expect((await db.query("SELECT count(*)::int AS n FROM failed_jobs WHERE job = 'digest'")).rows[0]).toEqual({ n: 1 });
  });
});
