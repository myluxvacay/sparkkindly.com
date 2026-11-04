// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { createSignInLimits, signInLimits } from '@/lib/admin/guard';
import { accountLinkLimits, createSignUpLimits } from '@/lib/accounts/limits';
import { requestAccountSignIn, submitSignUp } from '@/lib/accounts/web';
import { signUp } from '@/lib/accounts/signup';
import type { EmailMessage } from '@/lib/email';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-03T12:00:00Z');
const env = { ADMIN_LINK_BASE: 'https://staging.sparkkindly.com' };
const HEAD = {
  host: 'staging.sparkkindly.com',
  origin: 'https://staging.sparkkindly.com',
  'content-type': 'application/x-www-form-urlencoded',
};
const post = (body: Record<string, string>, ip = '192.0.2.1') =>
  new Request('http://localhost/x', {
    method: 'POST',
    headers: { ...HEAD, 'x-forwarded-for': ip },
    body: new URLSearchParams(body).toString(),
  });

type Overrides = { links?: ReturnType<typeof createSignInLimits>; signUps?: ReturnType<typeof createSignUpLimits> };

// Runs a handler with a defer that collects the deferred work, then awaits it, so assertions see the send.
async function run(
  fn: (d: Record<string, unknown>) => Promise<Response>,
  sent: EmailMessage[] = [],
  over: Overrides = {},
): Promise<Response> {
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
    ...over,
  });
  await Promise.all(jobs);
  return res;
}
const signIn = (email: string, sent: EmailMessage[] = [], over: Overrides = {}, ip?: string) =>
  run((d) => requestAccountSignIn(post({ email }, ip), d as never), sent, over);
const signUpPost = (email: string, sent: EmailMessage[] = [], over: Overrides = {}, ip?: string) =>
  run((d) => submitSignUp(post({ email, dob: '1990-05-05' }, ip), d as never), sent, over);
const snapshot = async (r: Response) => ({ status: r.status, location: r.headers.get('location'), body: await r.text() });
const count = async (t: string) => Number((await db.query<{ n: string }>(`SELECT count(*) n FROM ${t}`)).rows[0].n);

beforeAll(async () => {
  db = await newTestDb();
  await signUp(db, { email: 'known@example.test', dateOfBirth: '1990-05-05' }, NOW);
});
afterAll(async () => {
  await db.close();
});

describe('requestAccountSignIn', () => {
  it('known address: one email with the configured-host link; unknown: none, nothing written; same response', async () => {
    const sentK: EmailMessage[] = [];
    const sentU: EmailMessage[] = [];
    const k = await signIn('Known@Example.test', sentK);
    const tokens = await count('account_login_tokens');
    const u = await signIn('nobody@example.test', sentU);
    expect(sentK).toHaveLength(1);
    expect(sentK[0].to).toBe('known@example.test');
    expect(sentK[0].text).toMatch(
      /https:\/\/staging\.sparkkindly\.com\/account\/sign-in\/link\/\?token=[0-9a-f]{64}(\s|$)/,
    );
    expect(sentU).toHaveLength(0);
    expect(await count('account_login_tokens')).toBe(tokens);
    expect(await snapshot(k)).toEqual(await snapshot(u));
  });

  it('an unknown address spends nothing from the per-address allowance', async () => {
    const links = createSignInLimits(() => 0);
    const mint = vi.spyOn(links, 'mint');
    await signIn('ghost@example.test', [], { links });
    expect(mint).not.toHaveBeenCalled();
  });

  it('account requests never touch the admin limits state', async () => {
    const adminMint = vi.spyOn(signInLimits, 'mint');
    const adminClient = vi.spyOn(signInLimits, 'client');
    for (let i = 0; i < 8; i++) {
      await signIn('known@example.test', [], { links: accountLinkLimits }, '192.0.2.77');
    }
    expect(adminMint).not.toHaveBeenCalled();
    expect(adminClient).not.toHaveBeenCalled();
    adminMint.mockRestore();
    adminClient.mockRestore();
    // the same address and network can still get an admin link
    expect(signInLimits.mint('known@example.test')).toBe(true);
    expect(signInLimits.client('192.0.2.77')).toBe(true);
  });

  it('with no limits injected it uses the account instance, not the admin one', async () => {
    const adminMint = vi.spyOn(signInLimits, 'mint');
    const jobs: Promise<void>[] = [];
    await requestAccountSignIn(post({ email: 'known@example.test' }, '192.0.2.78'), {
      db,
      env,
      now: NOW,
      send: async () => ({}),
      defer: (w) => void jobs.push(w()),
    });
    await Promise.all(jobs);
    expect(adminMint).not.toHaveBeenCalled();
    adminMint.mockRestore();
  });
});

describe('submitSignUp', () => {
  it('created and exists both send one sign-in link and answer identically', async () => {
    const sentNew: EmailMessage[] = [];
    const sentOld: EmailMessage[] = [];
    const a = await signUpPost('fresh@example.test', sentNew);
    await db.query("UPDATE accounts SET verified_at = now() WHERE email = 'fresh@example.test'");
    const b = await signUpPost('fresh@example.test', sentOld);
    expect(sentNew).toHaveLength(1);
    expect(sentOld).toHaveLength(1);
    expect(sentOld[0].text).toMatch(/\/account\/sign-in\/link\/\?token=[0-9a-f]{64}/);
    expect(await snapshot(a)).toEqual(await snapshot(b));
  });

  it('the under-13 and parent-required redirects use neutral codes that do not reveal an age in the URL', async () => {
    const dob = (years: number) => `${2026 - years}-01-01`;
    const kid = await run((d) => submitSignUp(post({ email: 'kid@example.test', dob: dob(10) }), d as never));
    const teen = await run((d) => submitSignUp(post({ email: 'teen@example.test', dob: dob(14) }), d as never));
    expect(kid.headers.get('location')).toBe('/account/sign-up/?r=a');
    expect(teen.headers.get('location')).toBe('/account/sign-up/?r=b');
  });

  it('the 429 does not depend on the address', async () => {
    const signUps = createSignUpLimits(() => 0);
    for (let i = 0; i < 5; i++) await signUpPost(`rl${i}@example.test`, [], { signUps }, '192.0.2.50');
    const known = await signUpPost('known@example.test', [], { signUps }, '192.0.2.50');
    const unknown = await signUpPost('never-seen@example.test', [], { signUps }, '192.0.2.50');
    expect([known.status, unknown.status]).toEqual([429, 429]);
    expect(await known.text()).toBe(await unknown.text());
  });
});
