// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { createSignInLimits } from '@/lib/admin/guard';
import { createConfirmLimits, createConsentResendLimits, createSendBudget, createSignUpLimits } from '@/lib/accounts/limits';
import { confirmAccountLink, requestAccountSignIn, submitSignUp } from '@/lib/accounts/web';
import { confirmConsentRequest, resendConsentRequest, withdrawConsentRequest } from '@/lib/accounts/consent-web';
import { consentTarget, issueConsentTokens } from '@/lib/accounts/consent';
import { consumeAccountLink, getAccount, requestAccountLink } from '@/lib/accounts/sessions';
import { consentDay } from '@/lib/accounts/wording';
import { signUp } from '@/lib/accounts/signup';
import type { EmailMessage } from '@/lib/email';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-03T12:00:00Z');
const HOUR = 60 * 60_000;
const env = { ADMIN_LINK_BASE: 'https://staging.sparkkindly.com' };
const HEAD = {
  host: 'staging.sparkkindly.com',
  origin: 'https://staging.sparkkindly.com',
  'content-type': 'application/x-www-form-urlencoded',
};
const TEEN_DOB = '2011-12-01';
let n = 0;

const post = (body: Record<string, string>, opts: { cookie?: string; origin?: string | null } = {}) => {
  const headers: Record<string, string> = { ...HEAD, 'x-forwarded-for': '192.0.2.9' };
  if (opts.origin === null) delete headers.origin;
  else if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = `__Host-sk_account=${opts.cookie}`;
  return new Request('http://localhost/x', { method: 'POST', headers, body: new URLSearchParams(body).toString() });
};

type Over = { budget?: () => boolean; now?: Date; resends?: ReturnType<typeof createConsentResendLimits>; send?: (m: EmailMessage) => Promise<unknown> };
async function run(fn: (d: never) => Promise<Response>, sent: EmailMessage[] = [], over: Over = {}): Promise<Response> {
  const jobs: Promise<void>[] = [];
  const res = await fn({
    db,
    env,
    now: NOW,
    send: async (m: EmailMessage) => {
      sent.push(m);
      return {};
    },
    defer: (w: () => Promise<void>) => void jobs.push(w()),
    links: createSignInLimits(() => 0),
    signUps: createSignUpLimits(() => 0),
    confirms: createConfirmLimits(() => 0),
    resends: createConsentResendLimits(() => 0),
    budget: createSendBudget({ clock: () => 0, warn: () => {} }),
    ...over,
  } as never);
  await Promise.all(jobs);
  return res;
}

const parentOf = (i: number) => `parent${i}@example.test`;
async function teen(verified = false): Promise<{ id: string; email: string; parent: string }> {
  const i = n++;
  const email = `kid${i}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: TEEN_DOB, parentEmail: parentOf(i) }, NOW);
  if (r.status !== 'created') throw new Error('sign-up failed');
  if (verified) await db.query('UPDATE accounts SET verified_at = $2 WHERE id = $1', [r.accountId, NOW.toISOString()]);
  return { id: r.accountId, email, parent: parentOf(i) };
}
async function adult(): Promise<string> {
  const email = `adult${n++}@example.test`;
  await signUp(db, { email, dateOfBirth: '1990-05-05' }, NOW);
  return email;
}
const link = async (email: string) => (await requestAccountLink(db, email, env, NOW))!;
const session = async (email: string) => (await consumeAccountLink(db, await link(email), NOW))!;
const confirmLink = async (email: string, sent: EmailMessage[], over: Over = {}) => {
  const token = await link(email);
  return run((d) => confirmAccountLink(post({ token }), d), sent, over);
};
const state = async (id: string) =>
  (await db.query<{ consent_state: string }>('SELECT consent_state FROM accounts WHERE id = $1', [id])).rows[0]?.consent_state;
const tokenRows = async (id: string) =>
  (await db.query('SELECT used_at FROM account_consent_tokens WHERE account_id = $1', [id])).rows;

// Nothing a browser or a log can see may carry a token or the parent's address.
async function clean(r: Response, parent: string, tokens: string[] = []) {
  const seen = [r.headers.get('location') ?? '', await r.clone().text()].join(' ');
  expect(seen).not.toContain(parent);
  expect(seen).not.toMatch(/[0-9a-f]{64}/);
  for (const t of tokens) expect(seen).not.toContain(t);
}

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

describe('consent email after the holder confirms their own link', () => {
  it('a pending account: one email to the parent after the first confirm, none on the next sign-in', async () => {
    const t = await teen();
    const sent: EmailMessage[] = [];
    const r = await confirmLink(t.email, sent);
    expect(r.headers.get('location')).toBe('/account/');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(t.parent);
    expect(sent[0].text).toMatch(/https:\/\/staging\.sparkkindly\.com\/account\/consent\/\?token=[0-9a-f]{64}(\s|$)/m);
    expect(sent[0].text).toMatch(/https:\/\/staging\.sparkkindly\.com\/account\/consent\/withdraw\/\?token=[0-9a-f]{64}(\s|$)/m);
    expect(sent[0].text).toContain('https://staging.sparkkindly.com/privacy/');
    await clean(r, t.parent);
    const again: EmailMessage[] = [];
    await confirmLink(t.email, again, { now: new Date(NOW.getTime() + 2 * HOUR) });
    expect(again).toHaveLength(0);
  });

  it('no email for an adult (none) or an already confirmed account', async () => {
    const sentA: EmailMessage[] = [];
    await confirmLink(await adult(), sentA);
    expect(sentA).toHaveLength(0);
    const t = await teen(true);
    await db.query("UPDATE accounts SET consent_state = 'confirmed', consent_at = now() WHERE id = $1", [t.id]);
    const sentC: EmailMessage[] = [];
    await confirmLink(t.email, sentC);
    expect(sentC).toHaveLength(0);
  });

  it('no parent email on sign-up or on a sign-in link request', async () => {
    const i = n++;
    const email = `signup${i}@example.test`;
    const sent: EmailMessage[] = [];
    await run((d) => submitSignUp(post({ email, dob: TEEN_DOB, parent_email: parentOf(i) }), d), sent);
    await run((d) => requestAccountSignIn(post({ email }), d), sent, { now: new Date(NOW.getTime() + 2 * 60_000) });
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((m) => m.to === email)).toBe(true);
  });

  it('a budget-blocked send is silent: same answer, no email, no tokens issued', async () => {
    const t = await teen();
    const sent: EmailMessage[] = [];
    const r = await confirmLink(t.email, sent, { budget: () => false });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/account/');
    expect(sent).toHaveLength(0);
    expect(await tokenRows(t.id)).toHaveLength(0);
  });

  it('a failed send is logged without the parent address', async () => {
    const t = await teen();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await confirmLink(t.email, [], {
      send: async (m) => Promise.reject(new Error(`mail to ${m.to} refused`)),
    });
    expect(r.headers.get('location')).toBe('/account/');
    expect(error).toHaveBeenCalled();
    expect(error.mock.calls.flat().map(String).join(' ')).not.toContain(t.parent);
    error.mockRestore();
  });
});

describe('confirm and withdraw', () => {
  it('opening the confirm page (consentTarget) changes no row', async () => {
    const t = await teen(true);
    const { confirm } = (await issueConsentTokens(db, t.id, NOW))!;
    const before = await tokenRows(t.id);
    expect((await consentTarget(db, confirm, 'confirm', NOW))?.maskedParent).toBe('p•••@example.test');
    expect(await tokenRows(t.id)).toEqual(before);
    expect(await state(t.id)).toBe('pending');
  });

  it('a POST without a same-origin Origin is 403 and changes nothing', async () => {
    const t = await teen(true);
    const { confirm, withdraw } = (await issueConsentTokens(db, t.id, NOW))!;
    for (const origin of [null, 'https://evil.example']) {
      expect((await run((d) => confirmConsentRequest(post({ token: confirm }, { origin }), d))).status).toBe(403);
      expect((await run((d) => withdrawConsentRequest(post({ token: withdraw }, { origin }), d))).status).toBe(403);
    }
    expect(await state(t.id)).toBe('pending');
  });

  it('confirm records consent and redirects to the done page; reuse is invalid', async () => {
    const t = await teen(true);
    const { confirm } = (await issueConsentTokens(db, t.id, NOW))!;
    const r = await run((d) => confirmConsentRequest(post({ token: confirm }), d));
    expect([r.status, r.headers.get('location')]).toEqual([303, '/account/consent/?done=confirmed#result']);
    expect(await state(t.id)).toBe('confirmed');
    expect((await getAccount(db, await session(t.email), NOW))?.consentAt?.toISOString()).toBe(NOW.toISOString());
    await clean(r, t.parent, [confirm]);
    const again = await run((d) => confirmConsentRequest(post({ token: confirm }), d));
    expect(again.headers.get('location')).toBe('/account/consent/?invalid=1#result');
  });

  it('withdraw deletes the account and redirects to the done page; a bad token is invalid', async () => {
    const t = await teen(true);
    const { withdraw } = (await issueConsentTokens(db, t.id, NOW))!;
    const bad = await run((d) => withdrawConsentRequest(post({ token: '0'.repeat(64) }), d));
    expect(bad.headers.get('location')).toBe('/account/consent/?invalid=1#result');
    const r = await run((d) => withdrawConsentRequest(post({ token: withdraw }), d));
    expect([r.status, r.headers.get('location')]).toEqual([303, '/account/consent/?done=withdrawn#result']);
    expect(await state(t.id)).toBeUndefined();
    await clean(r, t.parent, [withdraw]);
  });

  it('confirm and withdraw share the per-network confirm limit', async () => {
    const confirms = createConfirmLimits(() => 0);
    const codes: number[] = [];
    for (let i = 0; i < 61; i++) {
      const r = await run((d) => confirmConsentRequest(post({ token: '0'.repeat(64) }), { ...(d as object), confirms } as never));
      codes.push(r.status);
    }
    expect(codes.at(-1)).toBe(429);
    const w = await run((d) => withdrawConsentRequest(post({ token: '0'.repeat(64) }), { ...(d as object), confirms } as never));
    expect(w.status).toBe(429);
  });
});

it('the consent date reads as a plain UTC day', () => {
  expect(consentDay(new Date('2026-11-03T23:30:00Z'))).toBe('3 November 2026');
});

describe('resendConsentRequest', () => {
  const resend = (cookie: string | undefined, sent: EmailMessage[], over: Over = {}) =>
    run((d) => resendConsentRequest(post({}, { cookie }), d), sent, over);

  it('no session: back to sign-in, nothing sent', async () => {
    const sent: EmailMessage[] = [];
    const r = await resend(undefined, sent);
    expect(r.headers.get('location')).toBe('/account/sign-in/');
    expect(sent).toHaveLength(0);
  });

  it('refused for an account that is not pending', async () => {
    const sent: EmailMessage[] = [];
    const r = await resend(await session(await adult()), sent);
    expect(r.headers.get('location')).toBe('/account/');
    expect(sent).toHaveLength(0);
  });

  it('a pending account: one resend an hour', async () => {
    const t = await teen();
    const s = await session(t.email);
    let clock = 0;
    const resends = createConsentResendLimits(() => clock);
    const sent: EmailMessage[] = [];
    const a = await resend(s, sent, { resends });
    expect(a.headers.get('location')).toBe('/account/?consent=resent#result');
    expect(sent.map((m) => m.to)).toEqual([t.parent]);
    await clean(a, t.parent);
    clock = HOUR / 2;
    const b = await resend(s, sent, { resends });
    expect(b.headers.get('location')).toBe('/account/?consent=wait#result');
    expect(sent).toHaveLength(1);
    clock = HOUR + 1;
    await resend(s, sent, { resends });
    expect(sent).toHaveLength(2);
  });

  it('a POST without a same-origin Origin is 403', async () => {
    const t = await teen();
    const sent: EmailMessage[] = [];
    const cookie = await session(t.email);
    const r = await run((d) => resendConsentRequest(post({}, { cookie, origin: 'https://evil.example' }), d), sent);
    expect(r.status).toBe(403);
    expect(sent).toHaveLength(0);
  });
});
