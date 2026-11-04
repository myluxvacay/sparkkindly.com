// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { createSignInLimits, signInLimits } from '@/lib/admin/guard';
import { accountLinkLimits, createAccountLinkLimits, createSendBudget, createSignUpLimits } from '@/lib/accounts/limits';
import { confirmAccountLink, requestAccountSignIn, submitSignUp } from '@/lib/accounts/web';
import { consumeAccountLink, getAccount, requestAccountLink } from '@/lib/accounts/sessions';
import { createConfirmLimits } from '@/lib/accounts/limits';
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

type Overrides = {
  links?: ReturnType<typeof createSignInLimits>;
  signUps?: ReturnType<typeof createSignUpLimits>;
  budget?: () => boolean;
  now?: Date;
};

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
    budget: createSendBudget({ clock: () => 0, warn: () => {} }),
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
    // a minute later, past the fresh-link window (a second request within 60 seconds sends nothing by design)
    const b = await signUpPost('fresh@example.test', sentOld, { now: new Date(NOW.getTime() + 61_000) });
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
    for (let i = 0; i < 30; i++) await signUpPost(`rl${i}@example.test`, [], { signUps }, '192.0.2.50');
    const known = await signUpPost('known@example.test', [], { signUps }, '192.0.2.50');
    const unknown = await signUpPost('never-seen@example.test', [], { signUps }, '192.0.2.50');
    expect([known.status, unknown.status]).toEqual([429, 429]);
    expect(await known.text()).toBe(await unknown.text());
  });
});

describe('link email limits', () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms);
  const known = async (prefix: string, n: number) => {
    const list = Array.from({ length: n }, (_, i) => `${prefix}${i}@example.test`);
    for (const e of list) await signUp(db, { email: e, dateOfBirth: '1990-05-05' }, NOW);
    return list;
  };

  it('30 different known addresses from one network within an hour each get a link', async () => {
    const links = createAccountLinkLimits(() => 0);
    const sent: EmailMessage[] = [];
    for (const e of await known('school', 30)) await signIn(e, sent, { links }, '192.0.2.120');
    expect(new Set(sent.map((m) => m.to)).size).toBe(30);
  });

  it('one address is still capped at 6 links an hour, however it is asked', async () => {
    const links = createAccountLinkLimits(() => 0);
    const [e] = await known('capped', 1);
    const sent: EmailMessage[] = [];
    for (let i = 0; i < 10; i++) await signIn(e, sent, { links, now: at(i * 61_000) }, `192.0.2.${130 + i}`);
    expect(sent).toHaveLength(6);
  });

  it('a burst of 10 requests for one address sends one email and spends one mint; 10 over 5 minutes stay within 5', async () => {
    const links = createAccountLinkLimits(() => 0);
    const mint = vi.spyOn(links, 'mint');
    const [burst, spread] = await known('bomb', 2);
    const sentBurst: EmailMessage[] = [];
    for (let i = 0; i < 10; i++) await signIn(burst, sentBurst, { links, now: at(i * 5_000) }, `192.0.2.${150 + i}`);
    expect(sentBurst).toHaveLength(1);
    expect(mint).toHaveBeenCalledTimes(1);
    const sentSpread: EmailMessage[] = [];
    for (let i = 0; i < 10; i++) await signIn(spread, sentSpread, { links, now: at(i * 30_000) }, `192.0.2.${170 + i}`);
    expect(sentSpread.length).toBeLessThanOrEqual(5);
  });

  it('past the site-wide send budget a request sends nothing and answers the same', async () => {
    const warn = vi.fn();
    const budget = createSendBudget({ perHour: 2, clock: () => 0, warn });
    const sent: EmailMessage[] = [];
    const answers = [];
    for (const [i, e] of (await known('budget', 3)).entries()) {
      answers.push(await snapshot(await signIn(e, sent, { budget }, `192.0.2.${190 + i}`)));
    }
    expect(sent).toHaveLength(2);
    expect(answers[2]).toEqual(answers[0]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('confirmAccountLink', () => {
  const confirm = (token: string, cookie?: string) =>
    run((d) => {
      const req = post({ token });
      if (cookie) req.headers.set('cookie', `__Host-sk_account=${cookie}`);
      return confirmAccountLink(req, { ...d, confirms: createConfirmLimits(() => 0) } as never);
    });
  const cookieValue = (r: Response) => /__Host-sk_account=([0-9a-f]{64})/.exec(r.headers.get('set-cookie') ?? '')?.[1];

  it('switching accounts ends the session the browser already held', async () => {
    await signUp(db, { email: 'switch-a@example.test', dateOfBirth: '1990-05-05' }, NOW);
    await signUp(db, { email: 'switch-b@example.test', dateOfBirth: '1990-05-05' }, NOW);
    const old = (await consumeAccountLink(db, (await requestAccountLink(db, 'switch-a@example.test', env, NOW))!, NOW))!;
    const res = await confirm((await requestAccountLink(db, 'switch-b@example.test', env, NOW))!, old);
    expect(res.status).toBe(303);
    expect(await getAccount(db, old, NOW)).toBeNull();
    expect((await getAccount(db, cookieValue(res)!, NOW))?.email).toBe('switch-b@example.test');
  });

  it('a failed confirm leaves the current session alone', async () => {
    await signUp(db, { email: 'stay@example.test', dateOfBirth: '1990-05-05' }, NOW);
    const s = (await consumeAccountLink(db, (await requestAccountLink(db, 'stay@example.test', env, NOW))!, NOW))!;
    const res = await confirm('0'.repeat(64), s);
    expect(res.headers.get('location')).toBe('/account/sign-in/?expired=1');
    expect((await getAccount(db, s, NOW))?.email).toBe('stay@example.test');
  });
});

describe('residuals: budget scope, mint order, raw email', () => {
  const verified = async (e: string) => {
    await signUp(db, { email: e, dateOfBirth: '1990-05-05' }, NOW);
    await db.query('UPDATE accounts SET verified_at = $2 WHERE email = $1', [e, NOW.toISOString()]);
  };

  it('sign-up traffic exhausting the budget never blocks a verified member, but blocks an unverified address; same answer', async () => {
    const budget = createSendBudget({ perHour: 3, clock: () => 0, warn: () => {} });
    for (let i = 0; i < 5; i++) await signUpPost(`flood${i}@example.test`, [], { budget }, `198.51.${i}.1`);
    await verified('member@example.test');
    await signUp(db, { email: 'pending@example.test', dateOfBirth: '1990-05-05' }, NOW);
    const sentM: EmailMessage[] = [];
    const sentP: EmailMessage[] = [];
    const m = await signIn('member@example.test', sentM, { budget }, '198.51.100.7');
    const p = await signIn('pending@example.test', sentP, { budget }, '198.51.100.8');
    const u = await signIn('nobody-here@example.test', [], { budget }, '198.51.100.9');
    expect(sentM).toHaveLength(1);
    expect(sentP).toHaveLength(0);
    expect(await snapshot(m)).toEqual(await snapshot(p));
    expect(await snapshot(p)).toEqual(await snapshot(u));
  });

  it('a budget-blocked request does not spend the address hourly mint allowance', async () => {
    const links = createAccountLinkLimits(() => 0);
    const mint = vi.spyOn(links, 'mint');
    const budget = createSendBudget({ perHour: 0, clock: () => 0, warn: () => {} });
    await signUp(db, { email: 'nomint@example.test', dateOfBirth: '1990-05-05' }, NOW);
    await signIn('nomint@example.test', [], { links, budget }, '198.51.100.20');
    expect(mint).not.toHaveBeenCalled();
  });

  it('a Kelvin-sign address is invalid at the sign-up route and writes no row', async () => {
    const before = await count('accounts');
    const r = await signUpPost('admin\u212A@example.test');
    expect(r.headers.get('location')).toBe('/account/sign-up/?invalid=1');
    expect(await count('accounts')).toBe(before);
  });

  it('a Kelvin-sign variant of a known address gets no link at the sign-in route, and the same answer', async () => {
    await verified('admink@example.test');
    const sent: EmailMessage[] = [];
    const tokens = await count('account_login_tokens');
    const k = await signIn('admin\u212A@example.test', sent, {}, '198.51.100.30');
    const u = await signIn('nobody2@example.test', [], {}, '198.51.100.31');
    expect(sent).toHaveLength(0);
    expect(await count('account_login_tokens')).toBe(tokens);
    expect(await snapshot(k)).toEqual(await snapshot(u));
  });
});
