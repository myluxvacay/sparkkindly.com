// @vitest-environment node
// Adversarial matrix for the account surface (.claude/rules/data-isolation.md, "Required adversarial cases").
// Cases whose features do not exist yet are it.todo so later plans see them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { requestAccountLink, consumeAccountLink, getAccount, endAccountSession } from '@/lib/accounts/sessions';
import { can, type AgeGroup, type Capability, type Consent } from '@/lib/accounts/policy';
import { requestLink, consumeLink, getAdmin } from '@/lib/admin/sessions';
import { newToken } from '@/lib/tokens';
import { issueConsentTokens, consentTarget, confirmConsent, withdrawConsent } from '@/lib/accounts/consent';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const A = 'a@example.test';
const B = 'b@example.test';
const env = { ADMIN_EMAILS: A };

beforeAll(async () => {
  db = await newTestDb();
  await signUp(db, { email: A, dateOfBirth: '1990-05-05' }, T0);
  await signUp(db, { email: B, dateOfBirth: '1991-06-06' }, T0);
});
afterAll(async () => {
  await db.close();
});

async function link(email: string, at = T0) {
  return (await requestAccountLink(db, email, env, at))!;
}
async function signIn(email: string, at = T0) {
  return (await consumeAccountLink(db, await link(email, at), at))!;
}

describe('own account allowed, never another', () => {
  it('a session yields exactly its own account', async () => {
    const sa = await signIn(A);
    const sb = await signIn(B);
    const a = await getAccount(db, sa, T0);
    const b = await getAccount(db, sb, T0);
    expect(a?.email).toBe(A);
    expect(b?.email).toBe(B);
    expect(a?.id).not.toBe(b?.id);
  });

  it('tampered, guessed, link and admin tokens never yield an account', async () => {
    const sa = await signIn(A);
    const flipped = (sa[0] === '0' ? '1' : '0') + sa.slice(1);
    const pendingLink = await link(A);
    const adminLink = (await requestLink(db, A, env, T0))!;
    const adminSession = (await consumeLink(db, adminLink, env, T0))!;
    for (const t of [flipped, newToken(), pendingLink, adminSession, sa.toUpperCase(), ` ${sa}`, `${sa}x`, '', "' OR 1=1 --"]) {
      expect(await getAccount(db, t, T0)).toBeNull();
    }
    expect(await getAccount(db, sa, T0)).not.toBeNull();
  });

  it('a session token is not a link token, and a link token is not a session', async () => {
    const sa = await signIn(A);
    expect(await consumeAccountLink(db, sa, T0)).toBeNull();
    expect(await getAccount(db, await link(A), T0)).toBeNull();
  });

  it('an account session is not an admin session, even for an allow-listed address', async () => {
    const sa = await signIn(A);
    expect(await getAdmin(db, sa, env, T0)).toBeNull();
  });
});

describe('no session fails closed', () => {
  // requireAccount (lib/accounts/next.ts) redirects to sign-in on null, so `can` is never reached without a group.
  it('missing, malformed, expired, signed-out and 90-day-capped sessions are anonymous', async () => {
    expect(await getAccount(db, '', T0)).toBeNull();
    expect(await getAccount(db, 'nope', T0)).toBeNull();
    expect(await getAccount(db, undefined as unknown as string, T0)).toBeNull();

    const idle = await signIn(A);
    expect(await getAccount(db, idle, plus(T0, 31 * DAY))).toBeNull();

    const out = await signIn(A);
    await endAccountSession(db, out);
    expect(await getAccount(db, out, T0)).toBeNull();

    const kept = await signIn(A);
    for (let d = 20; d <= 80; d += 20) {
      expect(await getAccount(db, kept, plus(T0, d * DAY))).not.toBeNull();
    }
    expect(await getAccount(db, kept, plus(T0, 91 * DAY))).toBeNull();
  });
});

describe('permission matrix through can()', () => {
  const caps: Capability[] = [
    'save_interests',
    'join_circle',
    'create_circle',
    'public_comment',
    'join_community',
    'contribute',
    'create_child_profile',
    'see_sponsorship',
    'essential_email',
    'marketing_email',
    'invite',
    'profile_page',
  ];
  const denied = (g: AgeGroup, c: Consent, list: Capability[]) => {
    for (const cap of list) expect(can(g, c, cap), `${g}/${c}/${cap}`).toBe(false);
  };
  const allowed = (g: AgeGroup, c: Consent, list: Capability[]) => {
    for (const cap of list) expect(can(g, c, cap), `${g}/${c}/${cap}`).toBe(true);
  };

  it('13-15 pending: no circles, comments, community, contribute, child profiles, sponsorship', () => {
    denied('teen_13_15', 'pending', [
      'join_circle',
      'create_circle',
      'public_comment',
      'join_community',
      'contribute',
      'create_child_profile',
      'see_sponsorship',
      'invite',
      'profile_page',
    ]);
  });
  it('13-15 confirmed: circles yes; comments, community, contribute, child profiles, sponsorship no', () => {
    allowed('teen_13_15', 'confirmed', ['join_circle', 'create_circle', 'invite']);
    denied('teen_13_15', 'confirmed', ['public_comment', 'join_community', 'contribute', 'create_child_profile', 'see_sponsorship', 'profile_page']);
  });
  it('13-15 with no consent state gets nothing', () => {
    denied('teen_13_15', 'none', caps);
  });
  it('16-17: no child profiles or sponsorship', () => {
    denied('teen_16_17', 'none', ['create_child_profile', 'see_sponsorship']);
    allowed('teen_16_17', 'none', ['public_comment', 'contribute', 'join_circle', 'invite', 'profile_page']);
  });
  it('under 13 is denied everything, whatever the consent state', () => {
    for (const c of ['none', 'pending', 'confirmed'] as Consent[]) denied('under_13', c, caps);
  });
  it('under 13 cannot hold an account: sign-up writes nothing', async () => {
    const before = await db.query('SELECT count(*)::int AS n FROM accounts');
    const r = await signUp(db, { email: 'kid@example.test', dateOfBirth: '2016-01-01', parentEmail: 'p@example.test' }, T0);
    expect(r.status).toBe('under_13');
    expect(await db.query('SELECT count(*)::int AS n FROM accounts')).toEqual(before);
    expect(await requestAccountLink(db, 'kid@example.test', env, T0)).toBeNull();
  });
});

describe('age is re-derived on every call', () => {
  it('moves to the next group on the 16th birthday with no job', async () => {
    const e = 'turning16@example.test';
    await signUp(db, { email: e, dateOfBirth: '2010-11-10', parentEmail: 'p2@example.test' }, T0);
    const s = await signIn(e);
    expect((await getAccount(db, s, plus(T0, 5 * DAY)))?.ageGroup).toBe('teen_13_15'); // 15 until 10 Nov 2026
    // fail closed: the birthday counts from 12:00 UTC (when it has begun everywhere), not 00:00 UTC
    expect((await getAccount(db, s, new Date('2026-11-10T00:00:00Z')))?.ageGroup).toBe('teen_13_15');
    expect((await getAccount(db, s, new Date('2026-11-10T11:59:00Z')))?.ageGroup).toBe('teen_13_15');
    expect((await getAccount(db, s, new Date('2026-11-10T12:00:00Z')))?.ageGroup).toBe('teen_16_17');
    expect((await getAccount(db, s, new Date('2026-11-11T08:00:00Z')))?.ageGroup).toBe('teen_16_17');
  });
});

describe('scope comes from the session, never a client id', () => {
  // Call sites checked: getAccount, endAccountSession, consumeAccountLink (token only); requestAccountLink and signUp
  // (address only, never an id); app/account pages and layout via requireAccount (cookie). No function takes an account id.
  it('a link for one address only starts a session for that address; case and whitespace variants are the same account', async () => {
    const viaVariant = (await consumeAccountLink(db, (await requestAccountLink(db, `  ${A.toUpperCase()} `, env, T0))!, T0))!;
    expect((await getAccount(db, viaVariant, T0))?.email).toBe(A);
    const viaB = (await consumeAccountLink(db, await link(B), T0))!;
    expect((await getAccount(db, viaB, T0))?.email).toBe(B);
  });

  it('sign-up over a verified address changes nothing, tokens included', async () => {
    const q = 'SELECT id, email, date_of_birth, consent_state, parent_email, verified_at FROM accounts WHERE email = $1';
    const before = await db.query(q, [A]);
    const pending = await link(A);
    const r = await signUp(db, { email: ` ${A.toUpperCase()}`, dateOfBirth: '2012-01-01', parentEmail: 'x@example.test' }, T0);
    expect(r.status).not.toBe('created');
    expect(await db.query(q, [A])).toEqual(before);
    expect(await consumeAccountLink(db, pending, T0)).not.toBeNull();
  });
});

describe('parental consent: capabilities follow the stored state, tokens reach only their own account', () => {
  const PARENT = 'parent@example.test';
  const capsOf = async (session: string) => {
    const a = (await getAccount(db, session, T0))!;
    return (['join_circle', 'invite', 'public_comment', 'join_community', 'contribute', 'profile_page', 'create_child_profile'] as Capability[]).filter(
      (c) => can(a.ageGroup, a.consent, c),
    );
  };
  async function teen(email: string, dob = '2011-12-01') {
    const r = await signUp(db, { email, dateOfBirth: dob, parentEmail: PARENT }, T0);
    if (r.status !== 'created') throw new Error('sign-up failed');
    await db.query('UPDATE accounts SET verified_at = $2 WHERE id = $1', [r.accountId, T0.toISOString()]);
    return r.accountId;
  }
  const exists = async (id: string) => (await db.query('SELECT 1 FROM accounts WHERE id = $1', [id])).rows.length === 1;

  it('a real 13-15 account is pending (nothing) until the parent confirms, then gets circles and invites only', async () => {
    const id = await teen('t1@example.test');
    const s = await signIn('t1@example.test');
    expect((await getAccount(db, s, T0))?.consent).toBe('pending');
    expect(await capsOf(s)).toEqual([]);
    const t = (await issueConsentTokens(db, id, T0))!;
    expect(await confirmConsent(db, t.confirm, T0)).toBe('confirmed');
    expect(await capsOf(s)).toEqual(['join_circle', 'invite']);
  });

  it('tampered, malformed, wrong-purpose and swapped tokens are refused and change nothing', async () => {
    const id = await teen('t2@example.test');
    const t = (await issueConsentTokens(db, id, T0))!;
    const flipped = (t.confirm[0] === '0' ? '1' : '0') + t.confirm.slice(1);
    for (const bad of [flipped, newToken(), '', "' OR 1=1 --", t.confirm.toUpperCase(), ` ${t.confirm}`, t.confirm + 'x']) {
      expect(await consentTarget(db, bad, 'confirm', T0)).toBeNull();
      expect(await confirmConsent(db, bad, T0)).toBe('invalid');
      expect(await withdrawConsent(db, bad, T0)).toBe('invalid');
    }
    // a confirm token cannot withdraw and a withdraw token cannot confirm
    expect(await withdrawConsent(db, t.confirm, T0)).toBe('invalid');
    expect(await confirmConsent(db, t.withdraw, T0)).toBe('invalid');
    expect(await exists(id)).toBe(true);
    expect((await getAccount(db, await signIn('t2@example.test'), T0))?.consent).toBe('pending');
  });

  it("another account's token acts only on its own account", async () => {
    const x = await teen('t3@example.test');
    const y = await teen('t4@example.test');
    const tx = (await issueConsentTokens(db, x, T0))!;
    const ty = (await issueConsentTokens(db, y, T0))!;
    expect((await consentTarget(db, tx.confirm, 'confirm', T0))?.accountId).toBe(x);
    expect(await confirmConsent(db, tx.confirm, T0)).toBe('confirmed');
    const state = async (id: string) => (await db.query<{ consent_state: string }>('SELECT consent_state FROM accounts WHERE id = $1', [id])).rows[0].consent_state;
    expect(await state(x)).toBe('confirmed');
    expect(await state(y)).toBe('pending');
    expect(await withdrawConsent(db, ty.withdraw, T0)).toBe('withdrawn');
    expect(await exists(y)).toBe(false);
    expect(await exists(x)).toBe(true);
    expect(await exists(await accountIdOf(A))).toBe(true);
  });

  it('a token whose parent address no longer matches the account is dead', async () => {
    const id = await teen('t5@example.test');
    const t = (await issueConsentTokens(db, id, T0))!;
    await db.query('UPDATE accounts SET parent_email = $2 WHERE id = $1', [id, 'other@example.test']);
    expect(await confirmConsent(db, t.confirm, T0)).toBe('invalid');
    expect(await withdrawConsent(db, t.withdraw, T0)).toBe('invalid');
    expect(await exists(id)).toBe(true);
  });

  it('a parent token signs nobody in and reads no account data', async () => {
    const id = await teen('t6@example.test');
    const t = (await issueConsentTokens(db, id, T0))!;
    for (const tok of [t.confirm, t.withdraw]) {
      expect(await getAccount(db, tok, T0)).toBeNull();
      expect(await consumeAccountLink(db, tok, T0)).toBeNull();
      expect(await getAdmin(db, tok, env, T0)).toBeNull();
    }
    // the only view a token gives is the masked parent address and the state, never the child's address or birth date
    const view = await consentTarget(db, t.confirm, 'confirm', T0);
    expect(Object.keys(view!).sort()).toEqual(['accountId', 'maskedParent', 'state']);
    expect(view!.maskedParent).not.toBe(PARENT);
    expect(JSON.stringify(view)).not.toContain('t6@example.test');
    // and a session or sign-in token is not a consent token
    const s = await signIn('t6@example.test');
    expect(await consentTarget(db, s, 'confirm', T0)).toBeNull();
    expect(await consentTarget(db, await link('t6@example.test'), 'withdraw', T0)).toBeNull();
  });

  it('tokens cleared at 16 can no longer confirm or withdraw', async () => {
    const id = await teen('t7@example.test', '2010-11-01'); // turns 16 on 1 Nov 2026
    const t = (await issueConsentTokens(db, id, T0))!;
    await db.query('DELETE FROM account_consent_tokens WHERE account_id = $1', [id]); // what the sweep does at 16
    expect(await confirmConsent(db, t.confirm, T0)).toBe('invalid');
    expect(await withdrawConsent(db, t.withdraw, T0)).toBe('invalid');
  });
});

async function accountIdOf(email: string) {
  return (await db.query<{ id: string }>('SELECT id FROM accounts WHERE email = $1', [email])).rows[0].id;
}

describe('arrives with later features', () => {
  it.todo('child profile -> adults item denied (list, detail, search, dashboard, daily set, email)');
  it.todo('child profile -> settings, invites, comments, contribute, admin denied');
  it.todo('13-15 account -> public comment, community join, contribute denied (route level; the capability rows above are covered through can())');
  it.todo('non-member -> circle denied');
  it.todo('tampered profile id / circle id / item id in payload denied');
  // agent key A -> agent B's items denied: covered in tests/unit/agent-api.test.ts and agent-keys.test.ts, not duplicated here.
});
