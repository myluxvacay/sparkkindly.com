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
import { createChildProfile, deleteChildProfile, listChildProfiles } from '@/lib/accounts/children';
import { getContext, requireAdultContext, switchToAdult, switchToProfile } from '@/lib/accounts/context';
import { checkPin } from '@/lib/accounts/pin';
import { changePinRequest, createChildRequest, deleteChildRequest, switchToChildRequest } from '@/lib/accounts/children-web';
import { issueConsentTokens, consentTarget, confirmConsent, withdrawConsent } from '@/lib/accounts/consent';
import { scopeForSession } from '@/lib/accounts/scope';
import { seedReference } from '@/db/seed';
import { dashboardFor } from '@/lib/accounts/dashboard';
import { getInterests, setInterests } from '@/lib/accounts/interests';
import { countAnswered, listAnswered, recordAnswer } from '@/lib/accounts/responses';
import { saveInterestsRequest } from '@/lib/accounts/interests-web';
import { viewerForSession } from '@/lib/accounts/scope';
import { findQuizBySlug, getPublicItem, latestQuiz, listPublic, listQuizzes, searchPublic } from '@/lib/public/reads';

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
    'save_answers',
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
      'save_answers',
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
    allowed('teen_13_15', 'confirmed', ['save_answers', 'join_circle', 'create_circle', 'invite']);
    denied('teen_13_15', 'confirmed', ['public_comment', 'join_community', 'contribute', 'create_child_profile', 'see_sponsorship', 'profile_page']);
  });
  it('13-15 with no consent state gets nothing', () => {
    denied('teen_13_15', 'none', caps);
  });
  it('16-17: no child profiles or sponsorship', () => {
    denied('teen_16_17', 'none', ['create_child_profile', 'see_sponsorship']);
    allowed('teen_16_17', 'none', ['save_answers', 'public_comment', 'contribute', 'join_circle', 'invite', 'profile_page']);
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

describe('child profiles (plan 3C): the child context is a security boundary', () => {
  const PIN = '4826';
  let n = 0;
  async function family() {
    const email = `fam${n++}@example.test`;
    const r = await signUp(db, { email, dateOfBirth: '1985-03-03' }, T0);
    if (r.status !== 'created') throw new Error('sign-up failed');
    const p = await createChildProfile(db, r.accountId, { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: PIN }, T0);
    if (p.status !== 'created') throw new Error('profile not created');
    return { accountId: r.accountId, profileId: p.profileId, session: await signIn(email) };
  }
  const post = (body: Record<string, string>, cookie: string) =>
    new Request('http://localhost/x', {
      method: 'POST',
      headers: {
        host: 'staging.sparkkindly.com',
        origin: 'https://staging.sparkkindly.com',
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `__Host-sk_account=${cookie}`,
      },
      body: new URLSearchParams(body).toString(),
    });

  it('own account: adult context sees kids, all and adults; the child context only kids and all', async () => {
    const f = await family();
    expect([...(await getContext(db, f.session, T0))!.audiences].sort()).toEqual(['adults', 'all', 'kids']);
    expect(await switchToProfile(db, f.session, f.profileId, T0)).toBe(true);
    const ctx = (await getContext(db, f.session, T0))!;
    expect([...ctx.audiences].sort()).toEqual(['all', 'kids']);
    expect(ctx.audiences).not.toContain('adults');
  });

  it('child context: no account (settings, invites, comments, contribute, admin all fail closed)', async () => {
    const f = await family();
    await switchToProfile(db, f.session, f.profileId, T0);
    expect(await getAccount(db, f.session, T0)).toBeNull();
    expect(requireAdultContext(await getContext(db, f.session, T0))).toBeNull();
    expect(await getAdmin(db, f.session, env, T0)).toBeNull();
    // the same session is the adult again once the PIN is given
    expect(await switchToAdult(db, f.session, PIN, T0)).toBe('ok');
    expect(await getAccount(db, f.session, T0)).not.toBeNull();
  });

  it("another account's profile id is denied for switch and delete, even though it is valid", async () => {
    const a = await family();
    const b = await family();
    expect(await switchToProfile(db, a.session, b.profileId, T0)).toBe(false);
    expect((await getContext(db, a.session, T0))?.profile).toBeNull();
    expect(await deleteChildProfile(db, a.accountId, b.profileId)).toBe(false);
    expect(await listChildProfiles(db, b.accountId)).toHaveLength(1);
    for (const bad of ['', 'nope', "' OR 1=1 --", '00000000-0000-0000-0000-000000000000']) {
      expect(await switchToProfile(db, a.session, bad, T0)).toBe(false);
      expect(await deleteChildProfile(db, a.accountId, bad)).toBe(false);
    }
  });

  it('a child cannot change the PIN, create or delete a profile, or switch to a sibling', async () => {
    const f = await family();
    await switchToProfile(db, f.session, f.profileId, T0);
    const d = { db, now: T0 };
    const refused = [
      await changePinRequest(post({ current_pin: PIN, new_pin: '1111', new_pin_confirm: '1111' }, f.session), d),
      await createChildRequest(post({ display_name: 'Sib', age_band: '6-9', guardian: 'on' }, f.session), d),
      await deleteChildRequest(post({ profile_id: f.profileId }, f.session), d),
      await switchToChildRequest(post({ profile_id: f.profileId }, f.session), d),
    ];
    for (const r of refused) expect(r.status).toBe(403);
    expect(await checkPin(db, f.accountId, PIN, T0)).toBe('ok');
    expect(await listChildProfiles(db, f.accountId)).toHaveLength(1);
  });

  it('deleting a profile ends the sessions on it (that device is signed out, never the adult)', async () => {
    const f = await family();
    await switchToProfile(db, f.session, f.profileId, T0);
    expect(await deleteChildProfile(db, f.accountId, f.profileId)).toBe(true);
    expect(await getContext(db, f.session, T0)).toBeNull();
  });

  it('deleting an account removes its child profiles (and sessions), and no other family loses any', async () => {
    const a = await family();
    const b = await family();
    await db.query('DELETE FROM accounts WHERE id = $1', [a.accountId]);
    expect(await listChildProfiles(db, a.accountId)).toEqual([]);
    expect((await db.query('SELECT 1 FROM account_sessions WHERE account_id = $1', [a.accountId])).rows).toHaveLength(0);
    expect(await listChildProfiles(db, b.accountId)).toHaveLength(1);
  });

  it('anonymous: the adult POSTs go to sign-in and change nothing', async () => {
    const r = await createChildRequest(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { host: 'staging.sparkkindly.com', origin: 'https://staging.sparkkindly.com', 'content-type': 'application/x-www-form-urlencoded' },
        body: 'display_name=Mia&age_band=6-9&guardian=on&pin=1234&pin_confirm=1234',
      }),
      { db, now: T0 },
    );
    expect([r.status, r.headers.get('location')]).toEqual([303, '/account/sign-in/']);
  });
});

describe('child profile -> adults item denied on the public reads, through the session scope (plan 3D, Task 2)', () => {
  // Every public page and route reads with currentScope() (lib/accounts/scope-next.ts) -> scopeForSession; the share
  // image route reads through getPublicItem, so the detail row covers it.
  const page = { limit: 50, offset: 0 };
  let child = '';
  let adult = '';
  const slugs = (items: { slug: string }[]) => items.map((i) => i.slug);
  async function put(slug: string, kind: string, audience: string) {
    const r = await db.query<{ id: string }>(
      `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
       SELECT id, $2, $1, 'Quokkaline ' || $1, 'A quokkaline summary.', '{}'::jsonb, $3, 'published', '2026-10-31T00:00:00Z', 'test', 'computable', 'test'
       FROM worlds WHERE slug = 'grow' RETURNING id`,
      [slug, kind, audience],
    );
    await db.query("INSERT INTO item_topics (item_id, topic_id) SELECT $1, id FROM topics WHERE slug = 'physics'", [r.rows[0].id]);
  }

  beforeAll(async () => {
    await seedReference(db);
    await put('iso-adults-article', 'article', 'adults');
    await put('iso-adults-quiz', 'quiz', 'adults');
    await put('iso-all-article', 'article', 'all');
    const email = 'scope-family@example.test';
    const r = await signUp(db, { email, dateOfBirth: '1984-04-04' }, T0);
    if (r.status !== 'created') throw new Error('sign-up failed');
    const p = await createChildProfile(db, r.accountId, { displayName: 'Ivy', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (p.status !== 'created') throw new Error('profile not created');
    child = await signIn(email);
    adult = await signIn(email);
    expect(await switchToProfile(db, child, p.profileId, T0)).toBe(true);
  });

  it('detail (item page, report page, share image): null for the child, the item for the adult and anonymous', async () => {
    const asChild = await scopeForSession(db, child, T0);
    expect(await getPublicItem(db, asChild, 'grow', 'iso-adults-article')).toBeNull();
    expect((await getPublicItem(db, asChild, 'grow', 'iso-all-article'))?.slug).toBe('iso-all-article');
    for (const token of [adult, undefined]) {
      expect((await getPublicItem(db, await scopeForSession(db, token, T0), 'grow', 'iso-adults-article'))?.slug).toBe('iso-adults-article');
    }
  });

  it('world list, topic list, search and every quiz read exclude adults items for the child only', async () => {
    const reads = async (token: string | undefined) => {
      const s = await scopeForSession(db, token, T0);
      return [
        ...slugs(await listPublic(db, s, { world: 'grow', ...page })),
        ...slugs(await listPublic(db, s, { topic: 'physics', ...page })),
        ...slugs(await searchPublic(db, s, 'quokkaline', page)),
        ...slugs(await listQuizzes(db, s, page)),
        (await latestQuiz(db, s))?.slug,
        (await findQuizBySlug(db, s, 'iso-adults-quiz'))?.slug,
      ];
    };
    const asChild = await reads(child);
    expect(asChild).not.toContain('iso-adults-article');
    expect(asChild).not.toContain('iso-adults-quiz');
    expect(asChild).toContain('iso-all-article');
    for (const token of [adult, undefined]) {
      const seen = await reads(token);
      expect(seen).toContain('iso-adults-article');
      expect(seen).toContain('iso-adults-quiz');
    }
  });
});

describe('interests, saved answers and /me (plan 3D, Task 5)', () => {
  const NOW = new Date('2026-11-04T12:00:00Z');
  let k = 0;
  const own = (ctx: { account: { id: string }; profile: { id: string } | null }) => ({ accountId: ctx.account.id, profileId: ctx.profile?.id ?? null });
  async function item(audience: string): Promise<string> {
    const r = await db.query<{ id: string }>(
      `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
       SELECT id, 'quiz', $1, 'T', 'S', '{}'::jsonb, $2, 'published', '2026-11-04T09:00:00Z', 'test', 'computable', 'test'
       FROM worlds WHERE slug = 'play' RETURNING id`,
      [`me-iso-${k++}`, audience],
    );
    return r.rows[0].id;
  }
  async function holder(dob = '1988-01-01', parent?: string) {
    const email = `me-iso${k++}@example.test`;
    const r = await signUp(db, { email, dateOfBirth: dob, parentEmail: parent }, T0);
    if (r.status !== 'created') throw new Error('sign-up failed');
    return { accountId: r.accountId, session: await signIn(email) };
  }
  const topicId = async () => (await db.query<{ id: number }>('SELECT id FROM topics ORDER BY id LIMIT 1')).rows[0].id;
  const form = (body: Record<string, string>, cookie: string) =>
    new Request('http://localhost/x', {
      method: 'POST',
      headers: {
        host: 'staging.sparkkindly.com',
        origin: 'https://staging.sparkkindly.com',
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `__Host-sk_account=${cookie}`,
      },
      body: new URLSearchParams(body).toString(),
    });
  const everyone = { audiences: ['kids', 'all', 'adults'] as ('kids' | 'all' | 'adults')[], now: NOW };

  beforeAll(async () => {
    await seedReference(db);
  });

  it('child profile: /me data (today, recent, answered, count) holds no adults item', async () => {
    const a = await holder();
    const p = await createChildProfile(db, a.accountId, { displayName: 'Kit', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (p.status !== 'created') throw new Error('profile not created');
    await switchToProfile(db, a.session, p.profileId, NOW);
    const ctx = (await getContext(db, a.session, NOW))!;
    const adults = await item('adults');
    const kids = await item('kids');
    const play = (await db.query<{ id: number }>("SELECT id FROM worlds WHERE slug = 'play'")).rows[0].id;
    await setInterests(db, own(ctx), { topicIds: [], worldIds: [play] });
    await recordAnswer(db, own(ctx), adults, true, NOW);
    await recordAnswer(db, own(ctx), kids, true, NOW);
    const d = await dashboardFor(db, ctx, NOW);
    const shown = [...d.today, ...d.recent, ...d.answered.map((x) => x.item)];
    expect(shown.map((i) => i.id)).toContain(kids);
    expect(shown.some((i) => i.id === adults || i.audience === 'adults')).toBe(false);
    expect(d.progress).toEqual({ total: 1, correct: 1 }); // the adults answer row exists but is not counted
  });

  it("account A's interests and answers are not reachable through account B, even with A's profile id", async () => {
    const a = await holder();
    const b = await holder();
    const pa = await createChildProfile(db, a.accountId, { displayName: 'Ann', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (pa.status !== 'created') throw new Error('profile not created');
    const t = await topicId();
    const it1 = await item('all');
    expect(await setInterests(db, { accountId: a.accountId, profileId: null }, { topicIds: [t], worldIds: [] })).toBe('ok');
    expect(await recordAnswer(db, { accountId: a.accountId, profileId: pa.profileId }, it1, true, NOW)).toBe(true);
    const asB = { accountId: b.accountId, profileId: null };
    expect(await getInterests(db, asB)).toEqual({ topicIds: [], worldIds: [] });
    expect(await countAnswered(db, asB, everyone)).toEqual({ total: 0, correct: 0 });
    // B naming A's profile id writes nothing and reads nothing
    const forged = { accountId: b.accountId, profileId: pa.profileId };
    expect(await setInterests(db, forged, { topicIds: [t], worldIds: [] })).toBe('invalid');
    expect(await recordAnswer(db, forged, it1, true, NOW)).toBe(false);
    expect(await listAnswered(db, forged, everyone, { limit: 10, offset: 0 })).toEqual([]);
    expect((await db.query('SELECT 1 FROM profile_interests WHERE account_id = $1', [b.accountId])).rows).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM item_responses WHERE account_id = $1', [b.accountId])).rows).toHaveLength(0);
  });

  it('13-15 consent-pending: may save interests, but no answer is stored', async () => {
    const t = await holder('2011-12-01', 'parent-me@example.test');
    const ctx = (await getContext(db, t.session, T0))!;
    expect(ctx.account.consent).toBe('pending');
    expect((await viewerForSession(db, t.session, T0)).owner).toBeNull(); // no owner: the play panel never writes
    const r = await saveInterestsRequest(form({ topic: String(await topicId()) }, t.session), { db, now: T0 });
    expect(r.headers.get('location')).toContain('r=saved');
    expect((await getInterests(db, own(ctx))).topicIds).toHaveLength(1);
    expect((await db.query('SELECT 1 FROM item_responses WHERE account_id = $1', [t.accountId])).rows).toHaveLength(0);
  });

  it('tampered profile id / account id in the interests form is ignored; the session decides the owner', async () => {
    const a = await holder();
    const b = await holder();
    const pb = await createChildProfile(db, b.accountId, { displayName: 'Bea', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (pb.status !== 'created') throw new Error('profile not created');
    const t = await topicId();
    const r = await saveInterestsRequest(
      form({ topic: String(t), profile_id: pb.profileId, account_id: b.accountId, profileId: pb.profileId }, a.session),
      { db, now: T0 },
    );
    expect(r.headers.get('location')).toContain('r=saved');
    expect((await getInterests(db, { accountId: a.accountId, profileId: null })).topicIds).toEqual([t]);
    expect((await db.query('SELECT 1 FROM profile_interests WHERE account_id = $1', [b.accountId])).rows).toHaveLength(0);
  });

  it('anonymous: /me has no context (the page redirects to sign-in) and an interests POST goes to sign-in and saves nothing', async () => {
    expect(await getContext(db, '', T0)).toBeNull();
    expect(await getContext(db, newToken(), T0)).toBeNull();
    const r = await saveInterestsRequest(form({ topic: String(await topicId()) }, ''), { db, now: T0 });
    expect([r.status, r.headers.get('location')]).toEqual([303, '/account/sign-in/']);
  });
});

describe('arrives with later features', () => {
  // The public reads take the session scope and /me the context audiences (both tested above); later routes add their own row.
  it.todo('child profile -> adults item denied at the daily set and email routes (these routes do not exist yet)');
  it.todo('child profile -> invites, comments and contribute routes denied (routes do not exist yet; they must use requireAdultContext)');
  it.todo('13-15 account -> public comment, community join, contribute denied (route level; the capability rows above are covered through can())');
  it.todo('non-member -> circle denied');
  it.todo('tampered circle id / item id in payload denied (circles and the daily set do not exist yet; profile id tampering is covered above)');
  // agent key A -> agent B's items denied: covered in tests/unit/agent-api.test.ts and agent-keys.test.ts, not duplicated here.
});
