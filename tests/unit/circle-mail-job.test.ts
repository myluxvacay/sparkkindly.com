// @vitest-environment node
// The circle mail job (plan 4D Task 1): claims each (circle, kind, period) before sending, so a rerun or two concurrent
// runs mail once; caps, the clock-skew refusal, failures and the hourly worker tick.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { adult, circleOf, fixtures, item, join, type Fixtures } from '../helpers/circle-play';
import type { EmailMessage } from '@/lib/email';
import { claimCircleMail, runCircleMail } from '@/lib/jobs/circle-mail';
import { tick } from '../../worker/main';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let f: Fixtures;
const ENV = { UNSUBSCRIBE_SECRET: 'test-only-unsubscribe-secret-0123456789abcdef', ADMIN_LINK_BASE: 'https://staging.sparkkindly.com' };
const AT = new Date('2026-11-05T08:00:00Z');
const dbNow = async () => AT;

beforeAll(async () => {
  db = await newTestDb();
  f = await fixtures(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  for (const t of ['circles', 'accounts', 'items', 'failed_jobs', 'job_runs']) await db.query(`DELETE FROM ${t}`);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function optedIn(): Promise<string> {
  const id = await adult(db);
  await db.query("UPDATE accounts SET verified_at = '2026-11-01', notify_daily_set = true, notify_weekly_circle = true WHERE id = $1", [id]);
  return id;
}
async function circles(n: number): Promise<void> {
  await item(db, { world: f.worlds.a });
  for (let i = 0; i < n; i++) {
    const c = await circleOf(db, await optedIn(), { kind: 'friends' });
    await join(db, c.slug, await optedIn());
  }
}
const collector = () => {
  const out: EmailMessage[] = [];
  return { out, send: async (m: EmailMessage) => void out.push(m) };
};
const failedRows = async () => (await db.query<{ job: string; error: string }>('SELECT job, error FROM failed_jobs')).rows;

describe('runCircleMail', () => {
  // AT is a Thursday after 07:00 UTC: each circle is due its set-ready mail and this week's (caught-up) summary.
  it('sends each (circle, kind, period) once across reruns', async () => {
    await circles(2);
    const { out, send } = collector();
    expect(await runCircleMail(db, AT, send, { env: ENV, dbNow })).toMatchObject({ sent: 8 });
    expect(await runCircleMail(db, AT, send, { env: ENV, dbNow })).toMatchObject({ sent: 0 });
    expect(out).toHaveLength(8);
    expect(out[0].headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect((await db.query('SELECT count(*)::int AS n FROM circle_mail_log')).rows[0].n).toBe(4);
  });

  it('two concurrent runs send once', async () => {
    await circles(3);
    const { out, send } = collector();
    const [a, b] = await Promise.all([runCircleMail(db, AT, send, { env: ENV, dbNow }), runCircleMail(db, AT, send, { env: ENV, dbNow })]);
    expect(a.sent + b.sent).toBe(12);
    expect(new Set(out.map((m) => `${m.to} ${m.subject}`)).size).toBe(12);
    expect(out).toHaveLength(12);
  });

  it('respects the mail and circle caps; the rest go on the next run', async () => {
    await circles(3);
    const { out, send } = collector();
    await runCircleMail(db, AT, send, { env: ENV, dbNow, cap: { mails: 200, circles: 1 } });
    expect(out).toHaveLength(2);
    await runCircleMail(db, AT, send, { env: ENV, dbNow, cap: { mails: 4, circles: 50 } });
    expect(out).toHaveLength(6);
  });

  it('refuses on clock skew, with one alert', async () => {
    await circles(1);
    const { out, send } = collector();
    const r = await runCircleMail(db, AT, send, { env: ENV, dbNow: async () => new Date(AT.getTime() + 11 * 60_000) });
    expect(r).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(out).toEqual([]);
    expect((await failedRows()).map((x) => x.job)).toEqual(['circle-mail']);
  });

  it('sends nothing without UNSUBSCRIBE_SECRET', async () => {
    await circles(1);
    const { out, send } = collector();
    await runCircleMail(db, AT, send, { env: { ADMIN_LINK_BASE: 'https://x.test' }, dbNow });
    expect(out).toEqual([]);
    expect((await db.query('SELECT count(*)::int AS n FROM circle_mail_log')).rows[0].n).toBe(0);
  });

  it('ruling: a failed send is counted in one alert (no address) and not retried in that period', async () => {
    await circles(1);
    let calls = 0;
    const flaky = async (m: EmailMessage) => {
      calls++;
      if (calls === 1) throw new Error(`provider down for ${m.to}`);
    };
    expect(await runCircleMail(db, AT, flaky, { env: ENV, dbNow })).toEqual({ sent: 3, skipped: 0, failed: 1 });
    const rows = await failedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ job: 'circle-mail' });
    expect(rows[0].error).not.toContain('@');
    expect(await runCircleMail(db, AT, flaky, { env: ENV, dbNow })).toMatchObject({ sent: 0, failed: 0 });
    expect(calls).toBe(4);
  });
});

describe('the worker tick', () => {
  it('claims the circle mail once per UTC hour, only with circles on', async () => {
    expect(await claimCircleMail(db, AT)).toBe(true);
    expect(await claimCircleMail(db, new Date('2026-11-05T08:59:00Z'))).toBe(false);
    expect(await claimCircleMail(db, new Date('2026-11-05T09:00:00Z'))).toBe(true);
    await db.query('DELETE FROM job_runs');
    await circles(1);
    const { out, send } = collector();
    const off = await tick(db, AT, ENV, send, { delayMs: 0, dbNow });
    expect(off.some((l) => l.startsWith('circle mail'))).toBe(false);
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
    vi.stubEnv('CIRCLES_ENABLED', 'true');
    const log = await tick(db, AT, ENV, send, { delayMs: 0, dbNow });
    expect(log).toContain('circle mail: 4 sent, 0 skipped, 0 failed');
    expect(out.filter((m) => m.subject.includes('is ready'))).toHaveLength(2);
    expect(await tick(db, AT, ENV, send, { delayMs: 0, dbNow })).toContain('circle mail: done this hour');
  });
});
