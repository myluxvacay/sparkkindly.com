// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { requestAccountLink } from '@/lib/accounts/sessions';
import { issueConsentTokens, confirmConsent } from '@/lib/accounts/consent';
import { claimConsentSweep, deleteIfStillPending, runConsentSweep } from '@/lib/accounts/consent-sweep';
import { consentEmail } from '@/lib/accounts/consent-email';
import { tick } from '@/worker/main';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
type Sent = { to: string; subject: string; text: string };
let db: TestDb;
const V = new Date('2026-11-01T08:00:00Z'); // verified
const DAY = 24 * 60 * 60_000;
const day = (n: number) => new Date(V.getTime() + n * DAY);
const links = { base: 'https://example.test/' };
const PARENT = 'parent@example.test';
let n = 0;
const count = async (sql: string, p: unknown[] = []) => (await db.query<{ n: number }>(sql, p)).rows[0].n;
const accounts = () => count('SELECT count(*)::int AS n FROM accounts');
const okSend = () => vi.fn(async (m: Sent) => void m);

async function teen(opts: { dob?: string; verified?: boolean } = {}): Promise<{ id: string; email: string }> {
  const email = `teen${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: opts.dob ?? '2011-12-01', parentEmail: PARENT }, V);
  if (r.status !== 'created') {
    throw new Error('sign-up failed');
  }
  if (opts.verified !== false) {
    await db.query('UPDATE accounts SET verified_at = $2 WHERE id = $1', [r.accountId, V.toISOString()]);
  }
  return { id: r.accountId, email };
}

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM account_login_tokens');
  await db.query('DELETE FROM job_runs');
});

describe('runConsentSweep', () => {
  it('does nothing on day 6', async () => {
    await teen();
    const send = okSend();
    expect(await runConsentSweep(db, day(6), send, links)).toEqual({ reminded: 0, deleted: 0, cleared: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one reminder at day 7, not again the same or next day, with working links', async () => {
    await teen();
    const send = okSend();
    expect((await runConsentSweep(db, day(7), send, links)).reminded).toBe(1);
    expect((await runConsentSweep(db, day(7), send, links)).reminded).toBe(0);
    expect((await runConsentSweep(db, day(8), send, links)).reminded).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const m = send.mock.calls[0][0];
    expect(m.to).toBe(PARENT);
    const confirm = /account\/consent\/\?token=([0-9a-f]{64})/.exec(m.text)![1];
    expect(m.text).toContain('https://example.test/account/consent/withdraw/?token=');
    expect(m.text).toContain('https://example.test/privacy/');
    expect(await confirmConsent(db, confirm, day(8))).toBe('confirmed');
  });

  it('a send failure leaves the reminder retryable', async () => {
    await teen();
    const bad = vi.fn(async (m: Sent) => {
      void m;
      throw new Error('mail down');
    });
    expect((await runConsentSweep(db, day(7), bad, links)).reminded).toBe(0);
    expect((await runConsentSweep(db, day(8), okSend(), links)).reminded).toBe(1);
  });

  it('deletes a pending verified account at day 30 with all its rows', async () => {
    const u = await teen();
    await requestAccountLink(db, u.email, {}, V);
    await issueConsentTokens(db, u.id, V);
    const send = okSend();
    expect((await runConsentSweep(db, day(29), send, links)).deleted).toBe(0);
    expect((await runConsentSweep(db, day(30), send, links)).deleted).toBe(1);
    expect(await accounts()).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM account_consent_tokens')).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM account_login_tokens')).toBe(0);
  });

  it('leaves a confirmed account untouched at day 40 and an unverified one alone', async () => {
    const c = await teen();
    const t = (await issueConsentTokens(db, c.id, V))!;
    await confirmConsent(db, t.confirm, V);
    await teen({ verified: false });
    expect(await runConsentSweep(db, day(40), okSend(), links)).toEqual({ reminded: 0, deleted: 0, cleared: 0 });
    expect(await accounts()).toBe(2);
  });

  it('clears the parent address and tokens at 16 but not for a 15-year-old', async () => {
    const sixteen = await teen({ dob: '2010-11-01' });
    const fifteen = await teen({ dob: '2011-01-01' });
    await issueConsentTokens(db, sixteen.id, V);
    await issueConsentTokens(db, fifteen.id, V);
    const r = await runConsentSweep(db, day(3), okSend(), links);
    expect(r).toMatchObject({ cleared: 1, deleted: 0 });
    const pe = async (id: string) =>
      (await db.query<{ parent_email: string | null }>('SELECT parent_email FROM accounts WHERE id = $1', [id])).rows[0]
        .parent_email;
    expect(await pe(sixteen.id)).toBeNull();
    expect(await pe(fifteen.id)).toBe(PARENT);
    const tokens = 'SELECT count(*)::int AS n FROM account_consent_tokens WHERE account_id = $1';
    expect(await count(tokens, [sixteen.id])).toBe(0);
    expect(await count(tokens, [fifteen.id])).toBe(2);
  });

  it('an account that turned 16 is not deleted at day 30', async () => {
    await teen({ dob: '2010-11-01' });
    await runConsentSweep(db, day(30), okSend(), links);
    expect(await accounts()).toBe(1);
  });
});

describe('deleteIfStillPending', () => {
  it('spares an account whose parent confirmed after it was listed, deletes one still pending', async () => {
    const a = await teen();
    const b = await teen();
    const t = await issueConsentTokens(db, a.id, V);
    expect(await confirmConsent(db, t!.confirm, day(29))).toBe('confirmed');
    const cutoff = day(0).toISOString();
    expect(await deleteIfStillPending(db, a.id, cutoff)).toBe(false);
    expect(await count('SELECT count(*)::int AS n FROM accounts WHERE id = $1', [a.id])).toBe(1);
    expect(await deleteIfStillPending(db, b.id, cutoff)).toBe(true);
    expect(await count('SELECT count(*)::int AS n FROM accounts WHERE id = $1', [b.id])).toBe(0);
  });
});

describe('claimConsentSweep and tick', () => {
  it('claims once per UTC day', async () => {
    expect(await claimConsentSweep(db, day(1))).toBe(true);
    expect(await claimConsentSweep(db, day(1))).toBe(false);
    expect(await claimConsentSweep(db, day(2))).toBe(true);
  });

  it('tick runs the sweep once per UTC day', async () => {
    await teen();
    const env = { DIGEST_HOUR_UTC: '23' };
    const send = okSend();
    const t = day(7);
    expect((await tick(db, t, env, send, { delayMs: 0 })).join(';')).toMatch(
      /consent sweep: 1 reminded, 0 deleted, 0 cleared/,
    );
    expect((await tick(db, new Date(t.getTime() + 60_000), env, send, { delayMs: 0 })).join(';')).toMatch(
      /consent sweep: done today/,
    );
  });
});

describe('consentEmail', () => {
  it('states what is collected, limits, deadline and all three links', () => {
    const l = { confirmUrl: 'https://x.test/c', withdrawUrl: 'https://x.test/w', privacyUrl: 'https://x.test/p' };
    for (const kind of ['request', 'reminder'] as const) {
      const { subject, text } = consentEmail(kind, l);
      expect(subject).toBeTruthy();
      const must = ['email address', 'date of birth', 'interests', 'answers and scores', 'public comments', '30 days'];
      for (const s of [...must, l.confirmUrl, l.withdrawUrl, l.privacyUrl]) {
        expect(text).toContain(s);
      }
    }
  });
});
