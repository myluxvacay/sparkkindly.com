// @vitest-environment node
// The 24-month inactivity job (plan 3E Task 2): one notice to the account's own address, deletion 30 days later only
// if still inactive (rechecked under the account row lock), a sign-in clears the notice. Unverified accounts (48 hour
// purge) and consent-pending teens (consent sweep) are never touched here.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { signUp } from '@/lib/accounts/signup';
import { requestAccountLink, consumeAccountLink } from '@/lib/accounts/sessions';
import { getContext } from '@/lib/accounts/context';
import { createChildProfile } from '@/lib/accounts/children';
import {
  claimInactivitySweep,
  deleteIfStillInactive,
  inactivityEmail,
  runInactivitySweep,
} from '@/lib/accounts/inactivity';
import { tick } from '@/worker/main';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
type Sent = { to: string; subject: string; text: string };
let db: TestDb;
const DAY = 24 * 60 * 60_000;
const V = new Date('2024-10-01T08:00:00Z'); // verified (first sign-in)
const at = (days: number) => new Date(V.getTime() + days * DAY);
const NOW = at(730); // exactly 24 months (730 days) after V
const links = { base: 'https://example.test/' };
let n = 0;
let item: string;
const count = async (sql: string, p: unknown[] = []) => (await db.query<{ n: number }>(sql, p)).rows[0].n;
const exists = async (id: string) => (await count('SELECT count(*)::int AS n FROM accounts WHERE id = $1', [id])) === 1;
const noticeAt = async (id: string) =>
  (await db.query<{ t: Date | null }>('SELECT inactivity_notice_at AS t FROM accounts WHERE id = $1', [id])).rows[0].t;
const okSend = () => vi.fn(async (m: Sent) => void m);
// The sweep refuses to run when its clock and the database's disagree; these tests simulate time, so the database
// clock is given as the same simulated instant. The tick tests below run at real time instead.
const sweep = (t: Date, send: (m: Sent) => Promise<unknown> = okSend()) =>
  runInactivitySweep(db, t, send, links, { dbNow: async () => t });
const alerts = async () =>
  (await db.query<{ error: string }>("SELECT error FROM failed_jobs WHERE job = 'inactivity-sweep'")).rows.map(
    (r) => r.error,
  );

async function account(opts: { dob?: string; parentEmail?: string } = {}): Promise<{ id: string; email: string }> {
  const email = `idle${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: opts.dob ?? '1990-05-05', parentEmail: opts.parentEmail }, V);
  if (r.status !== 'created') {
    throw new Error('sign-up failed');
  }
  return { id: r.accountId, email };
}
const signIn = async (email: string, when: Date) =>
  (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, when))!, when))!;
// A verified adult whose only session was created (and last seen) at V.
async function member(): Promise<{ id: string; email: string }> {
  const a = await account();
  await signIn(a.email, V);
  return a;
}
const answer = (accountId: string, profileId: string | null, when: Date) =>
  db.query(
    'INSERT INTO item_responses (account_id, profile_id, item_id, correct, answered_at) VALUES ($1,$2,$3,true,$4)',
    [accountId, profileId, item, when.toISOString()],
  );

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const w = (await db.query<{ id: number }>('SELECT id FROM worlds ORDER BY id LIMIT 1')).rows[0].id;
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1,'quiz','idle-item','T','S','{}'::jsonb,'all','published','2024-09-01T00:00:00Z','test','computable','test') RETURNING id`,
    [w],
  );
  item = r.rows[0].id;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM account_login_tokens');
  await db.query('DELETE FROM job_runs');
  await db.query('DELETE FROM failed_jobs');
});

describe('runInactivitySweep notices', () => {
  it('leaves an account seen within 24 months untouched', async () => {
    const a = await member();
    await signIn(a.email, at(400));
    const send = okSend();
    expect(await sweep(NOW, send)).toEqual({ noticed: 0, deleted: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await noticeAt(a.id)).toBeNull();
  });

  it('sends nothing at 729 days, then exactly one notice to the account address from 730 days', async () => {
    const a = await member();
    const send = okSend();
    expect((await sweep(at(729), send)).noticed).toBe(0);
    expect((await sweep(NOW, send)).noticed).toBe(1);
    expect((await sweep(NOW, send)).noticed).toBe(0);
    expect((await sweep(at(731), send)).noticed).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const m = send.mock.calls[0][0];
    expect(m.to).toBe(a.email);
    expect(m.text).toContain(at(760).toISOString().slice(0, 10));
    expect(m.text).toContain('https://example.test/account/sign-in/');
    expect(new Date((await noticeAt(a.id))!).toISOString()).toBe(NOW.toISOString());
  });

  it('an answer by the holder or any child profile within 24 months prevents the notice', async () => {
    const holder = await member();
    await answer(holder.id, null, at(500));
    const parent = await member();
    const p = await createChildProfile(
      db,
      parent.id,
      { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: '1234' },
      V,
    );
    if (p.status !== 'created') {
      throw new Error('profile not created');
    }
    await answer(parent.id, p.profileId, at(720));
    const send = okSend();
    expect((await sweep(NOW, send)).noticed).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('a verified account without sessions counts from verified_at', async () => {
    const old = await account();
    await db.query('UPDATE accounts SET verified_at = $2 WHERE id = $1', [old.id, V.toISOString()]);
    const recent = await account();
    await db.query('UPDATE accounts SET verified_at = $2 WHERE id = $1', [recent.id, at(600).toISOString()]);
    expect((await sweep(at(729), okSend())).noticed).toBe(0);
    const send = okSend();
    expect((await sweep(NOW, send)).noticed).toBe(1);
    expect(send.mock.calls[0][0].to).toBe(old.email);
  });

  it('never touches an unverified account or a consent-pending teen', async () => {
    const unverified = await account();
    const teen = await account({ dob: '2010-06-01', parentEmail: 'parent@example.test' });
    await db.query('UPDATE accounts SET verified_at = $2 WHERE id = $1', [teen.id, V.toISOString()]);
    const send = okSend();
    expect(await sweep(NOW, send)).toEqual({ noticed: 0, deleted: 0, failed: 0 });
    expect(await sweep(at(800), send)).toEqual({ noticed: 0, deleted: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await exists(unverified.id)).toBe(true);
    expect(await exists(teen.id)).toBe(true);
  });

  it('a send failure leaves the notice retryable and is counted', async () => {
    const a = await member();
    const bad = vi.fn(async (m: Sent) => {
      throw new Error(`mail down for ${m.to}`);
    });
    expect(await sweep(NOW, bad)).toEqual({ noticed: 0, deleted: 0, failed: 1 });
    expect(await noticeAt(a.id)).toBeNull();
    expect((await sweep(at(731), okSend())).noticed).toBe(1);
  });

  it('counts a notice only when the account was still inactive when it was recorded', async () => {
    const a = await member();
    // The holder signs in while the notice is on its way: the guarded UPDATE matches nothing.
    const send = vi.fn(async (m: Sent) => {
      void m;
      await db.query('UPDATE accounts SET last_sign_in_at = $2 WHERE id = $1', [a.id, NOW.toISOString()]);
    });
    expect(await sweep(NOW, send)).toEqual({ noticed: 0, deleted: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await noticeAt(a.id)).toBeNull();
  });

  it('future-dated activity (clock skew) keeps the account: never noticed, spared at deletion', async () => {
    const a = await member();
    await answer(a.id, null, at(5000));
    expect((await sweep(NOW)).noticed).toBe(0);
    await db.query('UPDATE accounts SET inactivity_notice_at = $2 WHERE id = $1', [a.id, NOW.toISOString()]);
    expect((await sweep(at(760))).deleted).toBe(0);
    expect(await exists(a.id)).toBe(true);
  });
});

// A browsing session refreshes the account's own last_seen_at (sessions are purged once expired).
describe('browse-only activity', () => {
  const lastSeen = async (id: string) =>
    new Date(
      (await db.query<{ t: Date }>('SELECT last_seen_at AS t FROM accounts WHERE id = $1', [id])).rows[0].t,
    ).toISOString();

  it('browsing until day 89 then purging the session counts from day 89', async () => {
    const a = await account();
    const session = await signIn(a.email, V);
    for (const d of [20, 40, 60, 80, 89]) {
      expect(await getContext(db, session, at(d))).not.toBeNull();
    }
    expect(await lastSeen(a.id)).toBe(at(89).toISOString());
    await db.query('DELETE FROM account_sessions');
    expect((await sweep(NOW)).noticed).toBe(0);
    expect((await sweep(at(818))).noticed).toBe(0);
    expect((await sweep(at(820))).noticed).toBe(1);
  });

  it('a sign-in sets last_seen_at, and the refresh writes it at most once an hour', async () => {
    const a = await account();
    const session = await signIn(a.email, V);
    expect(await lastSeen(a.id)).toBe(V.toISOString());
    const MIN = 60_000;
    const t = (m: number) => new Date(V.getTime() + m * MIN);
    await getContext(db, session, t(2));
    await getContext(db, session, t(59));
    expect(await lastSeen(a.id)).toBe(V.toISOString());
    await getContext(db, session, t(61));
    expect(await lastSeen(a.id)).toBe(t(61).toISOString());
    await getContext(db, session, t(63));
    await getContext(db, session, t(120));
    expect(await lastSeen(a.id)).toBe(t(61).toISOString());
  });
});

// Guards against a bug or bad data deleting many accounts at once.
describe('mass-deletion guards', () => {
  async function idle(k: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < k; i++) {
      ids.push((await account()).id);
    }
    await db.query('UPDATE accounts SET verified_at = $1', [V.toISOString()]);
    return ids;
  }

  it('notices at most 50 per run and raises one alert with counts only', async () => {
    await idle(60);
    const send = okSend();
    expect(await sweep(NOW, send)).toEqual({ noticed: 50, deleted: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(50);
    const a = await alerts();
    expect(a).toHaveLength(1);
    expect(a[0]).not.toContain('@');
    expect((await sweep(at(731))).noticed).toBe(10);
    expect(await alerts()).toHaveLength(1);
  });

  it('deletes at most 20 per run and raises one alert', async () => {
    await idle(25);
    await db.query('UPDATE accounts SET inactivity_notice_at = $1', [NOW.toISOString()]);
    expect(await sweep(at(760))).toEqual({ noticed: 0, deleted: 20, failed: 0 });
    expect(await count('SELECT count(*)::int AS n FROM accounts')).toBe(5);
    expect(await alerts()).toHaveLength(1);
  });

  it('refuses to run when the worker clock and the database clock differ by more than 10 minutes', async () => {
    const a = await member();
    const send = okSend();
    const skewed = (ms: number) =>
      runInactivitySweep(db, NOW, send, links, { dbNow: async () => new Date(NOW.getTime() + ms) });
    expect(await skewed(11 * 60_000)).toEqual({ noticed: 0, deleted: 0, failed: 0 });
    expect(await skewed(-11 * 60_000)).toEqual({ noticed: 0, deleted: 0, failed: 0 });
    // The default reads the real database clock, a month away from the simulated NOW.
    expect(await runInactivitySweep(db, NOW, send, links)).toEqual({ noticed: 0, deleted: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await noticeAt(a.id)).toBeNull();
    expect(await alerts()).toHaveLength(3);
    expect((await skewed(9 * 60_000)).noticed).toBe(1);
  });
});

describe('runInactivitySweep deletion', () => {
  it('deletes only 30 days after the notice, with all the account rows', async () => {
    const a = await member();
    await sweep(NOW, okSend());
    await requestAccountLink(db, a.email, {}, at(750));
    expect((await sweep(at(759), okSend())).deleted).toBe(0);
    expect(await exists(a.id)).toBe(true);
    expect((await sweep(at(760), okSend())).deleted).toBe(1);
    expect(await exists(a.id)).toBe(false);
    expect(await count('SELECT count(*)::int AS n FROM account_sessions')).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM account_login_tokens')).toBe(0);
  });

  it('signing in clears the notice, so the account is not deleted', async () => {
    const a = await member();
    await sweep(NOW, okSend());
    expect(await noticeAt(a.id)).not.toBeNull();
    await signIn(a.email, at(740));
    expect(await noticeAt(a.id)).toBeNull();
    const send = okSend();
    expect(await sweep(at(770), send)).toEqual({ noticed: 0, deleted: 0, failed: 0 });
    expect(await exists(a.id)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('an answer after the notice spares the account and clears the notice', async () => {
    const a = await member();
    await sweep(NOW, okSend());
    await answer(a.id, null, at(745));
    expect((await sweep(at(760), okSend())).deleted).toBe(0);
    expect(await exists(a.id)).toBe(true);
    expect(await noticeAt(a.id)).toBeNull();
  });
});

// Expired sessions are purged daily (lib/accounts/retention.ts), so a sign-in must be remembered on the account itself.
describe('last sign-in (sessions purged)', () => {
  const purgeSessions = () => db.query('DELETE FROM account_sessions');

  it('a sign-in records last_sign_in_at', async () => {
    const a = await member();
    await signIn(a.email, at(305));
    const r = await db.query<{ t: Date }>('SELECT last_sign_in_at AS t FROM accounts WHERE id = $1', [a.id]);
    expect(new Date(r.rows[0].t).toISOString()).toBe(at(305).toISOString());
  });

  it('a holder who signed in 14 months ago, with no live session and no answers, is not noticed', async () => {
    const a = await member();
    await signIn(a.email, at(305));
    await purgeSessions();
    const send = okSend();
    expect(await sweep(NOW, send)).toEqual({ noticed: 0, deleted: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('a holder whose last sign-in was 25 months ago is noticed', async () => {
    const a = await account();
    await signIn(a.email, at(-30));
    await purgeSessions();
    const send = okSend();
    expect((await sweep(NOW, send)).noticed).toBe(1);
    expect(send.mock.calls[0][0].to).toBe(a.email);
  });

  it('a sign-in after the notice clears it and spares the account at day 30, sessions purged or not', async () => {
    const a = await member();
    await sweep(NOW, okSend());
    await signIn(a.email, at(740));
    await purgeSessions();
    expect(await noticeAt(a.id)).toBeNull();
    const send = okSend();
    expect(await sweep(at(760), send)).toEqual({ noticed: 0, deleted: 0, failed: 0 });
    expect(await exists(a.id)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('the deletion recheck under the lock counts a sign-in whose session is already gone', async () => {
    const a = await member();
    await sweep(NOW, okSend());
    await db.query('UPDATE accounts SET last_sign_in_at = $2 WHERE id = $1', [a.id, at(750).toISOString()]);
    await purgeSessions();
    expect(await deleteIfStillInactive(db, a.id, at(760))).toBe(false);
    expect(await exists(a.id)).toBe(true);
    expect(await noticeAt(a.id)).toBeNull();
  });
});

describe('deleteIfStillInactive', () => {
  it('rechecks under the lock: an account active again after the listing is spared, a still-idle one deleted', async () => {
    const active = await member();
    const idle = await member();
    await sweep(NOW, okSend());
    // `active` was listed (its notice is due) but has signed in since; the session's last_seen_at moves on, the
    // notice is set again by hand to model a listing taken before the sign-in cleared it.
    await signIn(active.email, at(755));
    await db.query('UPDATE accounts SET inactivity_notice_at = $2 WHERE id = $1', [active.id, NOW.toISOString()]);
    expect(await deleteIfStillInactive(db, active.id, at(760))).toBe(false);
    expect(await exists(active.id)).toBe(true);
    expect(await noticeAt(active.id)).toBeNull();
    expect(await deleteIfStillInactive(db, idle.id, at(760))).toBe(true);
    expect(await exists(idle.id)).toBe(false);
  });

  it('does not delete before the notice is 30 days old or without a notice', async () => {
    const a = await member();
    expect(await deleteIfStillInactive(db, a.id, at(800))).toBe(false);
    await sweep(NOW, okSend());
    expect(await deleteIfStillInactive(db, a.id, at(759))).toBe(false);
    expect(await exists(a.id)).toBe(true);
  });
});

describe('claimInactivitySweep and tick', () => {
  it('claims once per UTC day', async () => {
    expect(await claimInactivitySweep(db, NOW)).toBe(true);
    expect(await claimInactivitySweep(db, NOW)).toBe(false);
    expect(await claimInactivitySweep(db, at(731))).toBe(true);
  });

  // The tick passes no clock override, so these run at real time (the database's clock): a member verified at V
  // (2024-10-01) is past 730 days from November 2026 on. The digest hour is set away from the current hour.
  const REAL = new Date();
  const env = { DIGEST_HOUR_UTC: String((REAL.getUTCHours() + 12) % 24) };

  it('tick runs the sweep once per UTC day', async () => {
    await member();
    const send = okSend();
    expect((await tick(db, REAL, env, send, { delayMs: 0 })).join(';')).toMatch(
      /inactivity sweep: 1 noticed, 0 deleted/,
    );
    expect((await tick(db, new Date(REAL.getTime() + 1000), env, send, { delayMs: 0 })).join(';')).toMatch(
      /inactivity sweep: done today/,
    );
  });

  it('a failed send logs no address anywhere', async () => {
    const a = await member();
    const spies = (['log', 'error', 'warn', 'info'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation(() => {}),
    );
    try {
      const bad = vi.fn(async (m: Sent) => {
        throw new Error(`550 rejected ${m.to}`);
      });
      const log = await tick(db, REAL, env, bad, { delayMs: 0 });
      expect(log.join(';')).toMatch(/inactivity sweep: 0 noticed, 0 deleted, 1 failed/);
      expect(log.join(';')).not.toContain(a.email);
      for (const s of spies) {
        expect(JSON.stringify(s.mock.calls)).not.toContain(a.email);
      }
      const failed = await db.query<{ error: string }>('SELECT error FROM failed_jobs');
      expect(JSON.stringify(failed.rows)).not.toContain(a.email);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe('inactivityEmail', () => {
  it('says what happens, when, and that signing in keeps the account', () => {
    const { subject, text } = inactivityEmail(new Date('2026-12-01T08:00:00Z'), 'https://x.test/account/sign-in/');
    expect(subject).toBeTruthy();
    for (const s of ['deleted', '2026-12-01', 'sign in', 'https://x.test/account/sign-in/']) {
      expect(text.toLowerCase()).toContain(s.toLowerCase());
    }
  });
});
