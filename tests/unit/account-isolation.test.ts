// @vitest-environment node
// Adversarial matrix for the account surface (.claude/rules/data-isolation.md, "Required adversarial cases").
// Cases whose features do not exist yet are it.todo so later plans see them.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
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
import { exportRequest, deleteAccountRequest, resetPinRequest, saveSettingsRequest } from '@/lib/accounts/settings-web';
import { deleteOwnAccount } from '@/lib/accounts/self-delete';
import { resetPin } from '@/lib/accounts/pin-reset';
import { getSettings, saveSettings } from '@/lib/accounts/settings';
import { runInactivitySweep } from '@/lib/accounts/inactivity';
import { applyUnsubscribe, readUnsubscribeToken, unsubscribeToken } from '@/lib/accounts/unsubscribe';
import { createCircle, getCircleForMember, leaveCircle, listMyCircles } from '@/lib/circles/repo';
import { addChildToCircle, circleHasChild, removeChildFromCircle } from '@/lib/circles/children';
import { closeCircle, removeMember, transferOwnership } from '@/lib/circles/owner';
import {
  addChildRequest,
  closeCircleRequest,
  createCircleRequest,
  leaveCircleRequest,
  loadCirclePage,
  removeChildRequest,
  removeMemberRequest,
  transferRequest,
} from '@/lib/circles/web';
import { acceptInvite, createEmailInvite, createLinkInvite, previewInvite, revokeInvite } from '@/lib/circles/invites';
import { joinCommunity } from '@/lib/circles/communities';
import {
  acceptInviteRequest,
  createLinkRequest,
  emailInviteRequest,
  joinCommunityRequest,
  loadInvitePage,
  revokeInviteRequest,
} from '@/lib/circles/invite-web';
import { item as playItem } from '../helpers/circle-play';
import { getOrCreateDailySet } from '@/lib/circles/daily-set';
import { getTallies } from '@/lib/circles/scores';
import { changeAnswerKey, listNotices } from '@/lib/circles/rescore';
import { loadScoresPage, loadSetPage, saveCircleInterestsRequest } from '@/lib/circles/play-web';
import { getCircleInterests } from '@/lib/circles/interests';
import { dailyMailFor, weeklyMailFor } from '@/lib/circles/mail';
import { reportCircle, reportCircleRequest } from '@/lib/circles/reports';
import { sharePromptFor } from '@/lib/circles/share-prompt';
import { handleAdminAction } from '@/lib/admin/act';
import { findQuizBySlug, getPublicItem, latestQuiz, listPublic, listQuizzes, searchPublic } from '@/lib/public/reads';
import { deleteComment, editComment, listPublishedComments, postComment } from '@/lib/comments/repo';
import { deleteCommentRequest, editCommentRequest, loadCommentSection, postCommentRequest } from '@/lib/comments/web';
import { setTrust } from '@/lib/comments/trust';
import { reportCommentRequest } from '@/lib/comments/report-web';
import { appealState, appealToken, fileAppeal } from '@/lib/comments/appeals';
import { createAgent } from '@/lib/agents/admin';
import { queueRequest, decideRequest } from '@/lib/comments/moderation-api';
import { createLimiter } from '@/lib/agents/rate-limit';
import { briefRequest, promotionsQueueRequest } from '@/lib/social/promotions-api';
import { agentRoute } from '@/lib/agents/http';
import { selectVideos } from '@/lib/social/video/select';
import { handleVideoUpload } from '@/lib/social/video/upload-route';
import { enableRequest, saveRequest, submitRequest, withdrawRequest } from '@/lib/contributors/web';
import { getMine } from '@/lib/contributors/drafts';
import { contributor as contributorFixture, drafted as draftedFixture } from '../helpers/contributors';
import { person as personFixture } from '../helpers/comments';
import { clickRequest, loadSponsorLine } from '@/lib/sponsorship/web';

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

describe('settings, export, deletion, inactivity and unsubscribe (plan 3E, Task 4)', () => {
  const NOW = new Date('2026-11-04T12:00:00Z');
  const PIN = '4826';
  let k = 0;
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
  async function item(slug: string): Promise<string> {
    const r = await db.query<{ id: string }>(
      `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
       SELECT id, 'quiz', $1, 'T', 'S', '{}'::jsonb, 'all', 'published', '2026-11-04T09:00:00Z', 'test', 'computable', 'test'
       FROM worlds WHERE slug = 'play' RETURNING id`,
      [slug],
    );
    return r.rows[0].id;
  }
  // A verified adult with a child profile, interests and answers (own and the child's), and a live session.
  async function holder(tag: string) {
    const email = `p3e-${tag}-${k++}@example.test`;
    const r = await signUp(db, { email, dateOfBirth: '1985-03-03' }, T0);
    if (r.status !== 'created') throw new Error('sign-up failed');
    const c = await createChildProfile(db, r.accountId, { displayName: `Kid${tag}`, ageBand: '6-9', guardianConfirmed: 'on', pin: PIN }, T0);
    if (c.status !== 'created') throw new Error('profile not created');
    const topic = (await db.query<{ id: number }>('SELECT id FROM topics ORDER BY id LIMIT 1')).rows[0].id;
    const slug = `p3e-item-${tag}-${k}`;
    const itemId = await item(slug);
    await setInterests(db, { accountId: r.accountId, profileId: null }, { topicIds: [topic], worldIds: [] });
    await recordAnswer(db, { accountId: r.accountId, profileId: null }, itemId, true, NOW);
    await recordAnswer(db, { accountId: r.accountId, profileId: c.profileId }, itemId, false, NOW);
    return { accountId: r.accountId, email, profileId: c.profileId, slug, session: await signIn(email) };
  }
  const count = async (sql: string, p: unknown[]) => (await db.query<{ n: number }>(sql, p)).rows[0].n;

  beforeAll(async () => {
    await seedReference(db);
  });

  it("account A's export holds none of account B's data", async () => {
    const a = await holder('xa');
    const b = await holder('xb');
    const res = await exportRequest(form({ account_id: b.accountId, profile_id: b.profileId, email: b.email }, a.session), { db, now: NOW });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    const x = JSON.parse(text);
    expect(x.account.email).toBe(a.email);
    expect(x.childProfiles.map((c: { displayName: string }) => c.displayName)).toEqual(['Kidxa']);
    for (const foreign of [b.email, b.accountId, b.profileId, b.slug, 'Kidxb']) {
      expect(text, foreign).not.toContain(foreign);
    }
    for (const mine of [a.slug, 'Kidxa']) expect(text).toContain(mine);
    expect(text).not.toMatch(/pin_hash|pinHash|token/i);
  });

  it('child context: settings save, export, delete and PIN reset are denied and change nothing', async () => {
    const f = await holder('ch');
    await switchToProfile(db, f.session, f.profileId, NOW);
    expect(requireAdultContext(await getContext(db, f.session, NOW))).toBeNull();
    const before = await getSettings(db, f.accountId);
    const pinOf = async () => (await db.query<{ pin_hash: string }>('SELECT pin_hash FROM accounts WHERE id = $1', [f.accountId])).rows[0].pin_hash;
    const pinBefore = await pinOf();
    const d = { db, now: NOW };
    const refused = [
      await saveSettingsRequest(form({ time_zone: 'Europe/London', daily_set: 'on' }, f.session), d),
      await exportRequest(form({}, f.session), d),
      await deleteAccountRequest(form({ email: f.email }, f.session), d),
      await resetPinRequest(form({ new_pin: '1111', new_pin_confirm: '1111' }, f.session), d),
    ];
    for (const r of refused) expect(r.status).toBe(403);
    expect(await resetPin(db, f.session, '1111', NOW)).toBe('not_allowed');
    expect(await getSettings(db, f.accountId)).toEqual(before);
    expect(await pinOf()).toBe(pinBefore);
    expect(await count('SELECT count(*)::int AS n FROM accounts WHERE id = $1', [f.accountId])).toBe(1);
  });

  it('anonymous: settings, export, delete and PIN reset go to sign-in and change nothing', async () => {
    const d = { db, now: NOW };
    for (const r of [
      await saveSettingsRequest(form({ time_zone: 'Europe/London' }, ''), d),
      await exportRequest(form({}, ''), d),
      await deleteAccountRequest(form({ email: A }, ''), d),
      await resetPinRequest(form({ new_pin: '1111', new_pin_confirm: '1111' }, ''), d),
    ]) {
      expect([r.status, r.headers.get('location')]).toEqual([303, '/account/sign-in/']);
    }
    expect(await count('SELECT count(*)::int AS n FROM accounts WHERE email = $1', [A])).toBe(1);
  });

  it('deleting an account leaves no row in any personal-data table (circles included), and B keeps every row of theirs', async () => {
    const a = await holder('da');
    const b = await holder('db');
    await link(a.email); // an unused sign-in link (no foreign key: removed by address)
    const teen = await signUp(db, { email: `p3e-teen-${k++}@example.test`, dateOfBirth: '2011-12-01', parentEmail: 'p3e-parent@example.test' }, T0);
    if (teen.status !== 'created') throw new Error('sign-up failed');
    await db.query('UPDATE accounts SET verified_at = $2 WHERE id = $1', [teen.accountId, T0.toISOString()]);
    expect(await issueConsentTokens(db, teen.accountId, T0)).not.toBeNull();
    const teenEmail = (await db.query<{ email: string }>('SELECT email FROM accounts WHERE id = $1', [teen.accountId])).rows[0].email;
    await link(teenEmail);
    // Circles (plan 4A): A owns a family circle holding A's child and B; B owns one A belongs to.
    const mine = await createCircle(db, a.accountId, { name: 'A home', kind: 'family', yourName: 'A' }, T0);
    const theirs = await createCircle(db, b.accountId, { name: 'B quiz', kind: 'friends', yourName: 'B' }, T0);
    if (mine.status !== 'created' || theirs.status !== 'created') throw new Error('circle failed');
    await db.query(
      `INSERT INTO circle_members (circle_id, account_id, display_name) SELECT id, $2::uuid, 'B' FROM circles WHERE slug = $1
       UNION ALL SELECT id, $3::uuid, 'A' FROM circles WHERE slug = $4`,
      [mine.slug, b.accountId, a.accountId, theirs.slug],
    );
    expect(await addChildToCircle(db, a.accountId, mine.slug, a.profileId, 'on', T0)).toBe('added');
    const owned = ['accounts WHERE id', 'account_sessions WHERE account_id', 'account_consent_tokens WHERE account_id', 'child_profiles WHERE account_id', 'profile_interests WHERE account_id', 'item_responses WHERE account_id', 'circle_members WHERE account_id', 'circles WHERE owner_account_id'];
    const rows = (t: string, id: string) => count(`SELECT count(*)::int AS n FROM ${t} = $1`, [id]);
    expect(await rows(owned[2], teen.accountId)).toBeGreaterThan(0);

    expect(await deleteOwnAccount(db, a.accountId, a.email)).toBe('deleted');
    expect(await deleteOwnAccount(db, teen.accountId, teenEmail)).toBe('deleted');
    for (const id of [a.accountId, teen.accountId]) {
      for (const t of owned) expect(await rows(t, id), `${t} ${id}`).toBe(0);
    }
    for (const e of [a.email, teenEmail]) {
      expect(await count('SELECT count(*)::int AS n FROM account_login_tokens WHERE email = $1', [e])).toBe(0);
    }
    for (const t of owned.filter((t) => !t.includes('consent'))) expect(await rows(t, b.accountId), `B ${t}`).toBeGreaterThan(0);
    // A's family circle passed to B, its only other adult member.
    expect((await getCircleForMember(db, b.accountId, mine.slug))!.myRole).toBe('owner');
  });

  // Final review 7: the tables are derived from the schema, so a new account-linked column is covered without editing.
  // Every foreign-key column to accounts(id) or child_profiles(id), and every email column, holds no value of A's after
  // the deletion; SET NULL columns (circle_reports.reporter_account_id, circle_invites.used_by) keep their row.
  async function accountLinkedColumns(): Promise<{ t: string; c: string; ref: string }[]> {
    const fk = await db.query<{ t: string; c: string; ref: string }>(
      `SELECT c.conrelid::regclass::text AS t, a.attname::text AS c, c.confrelid::regclass::text AS ref
       FROM pg_constraint c
       CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(child, parent)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.child
       JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.parent
       WHERE c.contype = 'f' AND c.confrelid IN ('accounts'::regclass, 'child_profiles'::regclass) AND pa.attname = 'id'`,
    );
    const mail = await db.query<{ t: string; c: string }>(
      `SELECT table_name::text AS t, column_name::text AS c FROM information_schema.columns
       WHERE table_schema = 'public' AND (column_name = 'email' OR column_name LIKE '%\\_email')`,
    );
    return [...fk.rows, ...mail.rows.map((m) => ({ ...m, ref: 'email' }))];
  }

  it('deleting an account leaves none of its ids or address in any account-linked column (derived from the schema)', async () => {
    const a = await holder('dx');
    const b = await holder('dy');
    await link(a.email);
    const mine = await createCircle(db, a.accountId, { name: 'A fam', kind: 'family', yourName: 'A' }, T0);
    const theirs = await createCircle(db, b.accountId, { name: 'B pals', kind: 'friends', yourName: 'B' }, T0);
    if (mine.status !== 'created' || theirs.status !== 'created') throw new Error('circle failed');
    const idOf = async (slug: string) => (await db.query<{ id: string }>('SELECT id FROM circles WHERE slug = $1', [slug])).rows[0].id;
    const [mineId, theirsId] = [await idOf(mine.slug), await idOf(theirs.slug)];
    await db.query("INSERT INTO circle_members (circle_id, account_id, display_name) VALUES ($1, $2, 'B'), ($3, $4, 'A')", [mineId, b.accountId, theirsId, a.accountId]);
    expect(await addChildToCircle(db, a.accountId, mine.slug, a.profileId, 'on', T0)).toBe('added');
    // Invites A made (link and email), an invite B sent to A's address, and the B invite A joined through.
    const inv = (circle: string, by: string, kind: string, email: string | null) =>
      db.query<{ id: string }>(
        `INSERT INTO circle_invites (circle_id, created_by, kind, token_hash, invited_email, expires_at)
         VALUES ($1, $2, $3, md5(random()::text), $4, CASE WHEN $3 = 'email' THEN now() + interval '14 days' END) RETURNING id`,
        [circle, by, kind, email],
      );
    await inv(mineId, a.accountId, 'link', null);
    await inv(mineId, a.accountId, 'email', `friend-${k++}@example.test`);
    await inv(theirsId, b.accountId, 'email', a.email);
    const joinedVia = (await inv(theirsId, b.accountId, 'link', null)).rows[0].id;
    await db.query('INSERT INTO referrals (invite_id, new_account_id) VALUES ($1, $2)', [joinedVia, a.accountId]);
    await db.query('UPDATE circle_invites SET used_by = $2 WHERE id = $1', [joinedVia, a.accountId]);
    await db.query("INSERT INTO circle_reports (circle_id, reporter_account_id, reason) VALUES ($1, $2, 'other')", [theirsId, a.accountId]);
    // Comments (7A): A's comment with B's reply under it, and A's trust row.
    const itemId = (await db.query<{ id: string }>('SELECT id FROM items WHERE slug = $1', [a.slug])).rows[0].id;
    const top = await db.query<{ id: string }>("INSERT INTO comments (item_id, account_id, body, status) VALUES ($1, $2, 'A says', 'published') RETURNING id", [itemId, a.accountId]);
    await db.query("INSERT INTO comments (item_id, account_id, parent_id, body, status) VALUES ($1, $2, $3, 'B replies', 'published')", [itemId, b.accountId, top.rows[0].id]);
    await db.query('INSERT INTO account_trust (account_id, display_name) VALUES ($1, $2)', [a.accountId, 'A name']);

    const columns = await accountLinkedColumns();
    for (const t of ['circle_invites', 'referrals', 'circle_reports', 'comments', 'account_trust', 'account_login_tokens']) {
      expect(columns.map((x) => x.t), t).toContain(t);
    }
    const valueFor = (ref: string) => (ref === 'accounts' ? a.accountId : ref === 'child_profiles' ? a.profileId : a.email);
    const held = async () => {
      const out: string[] = [];
      for (const { t, c, ref } of columns) {
        const n = await count(`SELECT count(*)::int AS n FROM ${t} WHERE ${c}::text = $1`, [valueFor(ref)]);
        if (n > 0) out.push(`${t}.${c}`);
      }
      return out.sort();
    };
    expect((await held()).length).toBeGreaterThan(8);

    expect(await deleteOwnAccount(db, a.accountId, a.email)).toBe('deleted');
    expect(await held()).toEqual([]);
    // SET NULL keeps the row: the report stays (moderation evidence) and B's invite keeps its use time.
    expect(await count('SELECT count(*)::int AS n FROM circle_reports WHERE circle_id = $1 AND reporter_account_id IS NULL', [theirsId])).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM circle_invites WHERE id = $1 AND used_by IS NULL', [joinedVia])).toBe(1);
    // B's reply went with A's comment; B's own rows stay.
    expect(await count("SELECT count(*)::int AS n FROM comments WHERE body = 'B replies'", [])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM circles WHERE owner_account_id = $1', [b.accountId])).toBe(2);
    // This file shares one database: leave no report behind for the later report-count rows.
    await db.query('DELETE FROM circle_reports WHERE circle_id = $1', [theirsId]);
  });

  it('the inactivity sweep spares accounts with a recent sign-in, a recent answer, or a stale notice and recent activity', async () => {
    const later = new Date(NOW.getTime() + 731 * DAY); // answers in holder() are dated NOW
    const recent = new Date(later.getTime() - 10 * DAY);
    const bySignIn = await holder('ia');
    const byAnswer = await holder('ib');
    const staleNotice = await holder('ic');
    const idle = await holder('id');
    // everyone last signed in at T0; one signed in again recently, one answered recently, one has a 31-day-old notice
    await consumeAccountLink(db, (await requestAccountLink(db, bySignIn.email, env, recent))!, recent);
    await recordAnswer(db, { accountId: byAnswer.accountId, profileId: null }, await item(`p3e-late-${k++}`), true, recent);
    await consumeAccountLink(db, (await requestAccountLink(db, staleNotice.email, env, recent))!, recent);
    await db.query('UPDATE accounts SET inactivity_notice_at = $2 WHERE id = $1', [staleNotice.accountId, new Date(later.getTime() - 31 * DAY).toISOString()]);
    const sent: string[] = [];
    const r = await runInactivitySweep(db, later, async (m) => void sent.push(m.to), { base: 'https://example.test' }, { dbNow: async () => later });
    expect(r.failed).toBe(0);
    for (const a of [bySignIn, byAnswer, staleNotice]) {
      expect(sent, a.email).not.toContain(a.email);
      expect(await count('SELECT count(*)::int AS n FROM accounts WHERE id = $1 AND inactivity_notice_at IS NULL', [a.accountId])).toBe(1);
    }
    // control: the idle account is noticed, and not deleted the same day
    expect(sent).toContain(idle.email);
    expect(await count('SELECT count(*)::int AS n FROM accounts WHERE id = $1', [idle.accountId])).toBe(1);
  });

  it('an unsubscribe token for one kind cannot change another kind, or another account', async () => {
    const SECRET = 'p3e-isolation-secret-0123456789abcdef-not-real';
    const a = await holder('ua');
    const b = await holder('ub');
    const all = { timeZone: 'UTC', notify: { dailySet: true, weeklyCircle: true, invites: true } };
    expect(await saveSettings(db, a.accountId, all)).toBe('ok');
    expect(await saveSettings(db, b.accountId, all)).toBe('ok');
    const tok = unsubscribeToken(SECRET, a.accountId, 'daily_set')!;
    const [id, , sig] = tok.split('.');
    for (const forged of [`${id}.invites.${sig}`, `${id}.weekly_circle.${sig}`, `${b.accountId}.daily_set.${sig}`, `${tok}.x`, tok.toUpperCase()]) {
      expect(readUnsubscribeToken(SECRET, forged), forged).toBeNull();
    }
    expect(readUnsubscribeToken('p3e-another-secret-0123456789abcdef-xx', tok)).toBeNull();
    const read = readUnsubscribeToken(SECRET, tok)!;
    expect(read).toEqual({ accountId: a.accountId, kind: 'daily_set' });
    expect(await applyUnsubscribe(db, read.accountId, read.kind)).toBe(true);
    expect((await getSettings(db, a.accountId))?.notify).toEqual({ dailySet: false, weeklyCircle: true, invites: true });
    expect((await getSettings(db, b.accountId))?.notify).toEqual({ dailySet: true, weeklyCircle: true, invites: true });
  });
});

describe('circles (plan 4A, Task 4)', () => {
  const NOW = new Date('2026-11-04T12:00:00Z');
  let c = 0;
  const headers = (cookie: string) => ({
    host: 'staging.sparkkindly.com',
    origin: 'https://staging.sparkkindly.com',
    'content-type': 'application/x-www-form-urlencoded',
    cookie: `__Host-sk_account=${cookie}`,
  });
  const req = (body: Record<string, string>, cookie: string) =>
    new Request('http://localhost/x', { method: 'POST', headers: headers(cookie), body: new URLSearchParams(body).toString() });
  const d = () => ({ db, now: NOW, limit: () => true });
  async function person(dateOfBirth = '1984-02-02') {
    const email = `p4a-${c++}@example.test`;
    const r = await signUp(db, { email, dateOfBirth }, T0);
    if (r.status !== 'created') throw new Error('sign-up failed');
    return { id: r.accountId, session: await signIn(email) };
  }
  async function circleOf(owner: { id: string }, kind = 'family') {
    const r = await createCircle(db, owner.id, { name: 'Isolation', kind, yourName: 'Owner' }, T0);
    if (r.status !== 'created') throw new Error('circle failed');
    return r.slug;
  }
  async function kidOf(accountId: string) {
    const k = await createChildProfile(db, accountId, { displayName: 'Kid', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (k.status !== 'created') throw new Error('profile failed');
    return k.profileId;
  }
  const enrol = (slug: string, accountId: string) =>
    db.query("INSERT INTO circle_members (circle_id, account_id, display_name) SELECT id, $2, 'M' FROM circles WHERE slug = $1", [
      slug,
      accountId,
    ]);
  const rowsOf = async (slug: string) =>
    (
      await db.query(
        'SELECT m.* FROM circle_members m JOIN circles x ON x.id = m.circle_id WHERE x.slug = $1 ORDER BY m.account_id, m.profile_id',
        [slug],
      )
    ).rows;
  const SCOPED = {
    leave: leaveCircleRequest,
    remove: removeMemberRequest,
    transfer: transferRequest,
    close: closeCircleRequest,
    addChild: addChildRequest,
    removeChild: removeChildRequest,
  };

  beforeEach(() => {
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
    vi.stubEnv('CIRCLES_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('own account -> own circle allowed (page and list)', async () => {
    const a = await person();
    const slug = await circleOf(a);
    expect((await loadCirclePage(db, a.session, slug, NOW)).status).toBe('ok');
    expect(await listMyCircles(db, a.id)).toHaveLength(1);
  });

  it("account A -> account B's circle denied; non-member -> 404 page, neutral POST answer, no change", async () => {
    const a = await person();
    const b = await person();
    const slug = await circleOf(b);
    expect(await getCircleForMember(db, a.id, slug)).toBeNull();
    expect(await loadCirclePage(db, a.session, slug, NOW)).toEqual({ status: 'not_found' });
    expect(await listMyCircles(db, a.id)).toEqual([]);
    const before = await rowsOf(slug);
    for (const [name, fn] of Object.entries(SCOPED)) {
      const r = await fn(req({ confirm: 'on', member_key: '0123456789abcdef', to_member: '0123456789abcdef' }, a.session), d(), slug);
      expect([r.status, r.headers.get('location')], name).toEqual([303, '/circles/?r=gone#result']);
    }
    expect(await rowsOf(slug)).toEqual(before);
  });

  it('child profile -> every circle write and the circle page denied', async () => {
    const a = await person();
    const slug = await circleOf(a);
    const kid = await kidOf(a.id);
    expect(await switchToProfile(db, a.session, kid, NOW)).toBe(true);
    const before = await rowsOf(slug);
    expect((await createCircleRequest(req({ name: 'Kids', kind: 'friends', your_name: 'K' }, a.session), d())).status).toBe(403);
    for (const [name, fn] of Object.entries(SCOPED)) {
      expect((await fn(req({ confirm: 'on', profile_id: kid }, a.session), d(), slug)).status, name).toBe(403);
    }
    expect(await loadCirclePage(db, a.session, slug, NOW)).toEqual({ status: 'child' });
    expect(await rowsOf(slug)).toEqual(before);
  });

  it('tampered circle / member / profile ids are denied and change nothing', async () => {
    const a = await person();
    const b = await person();
    const s = await person();
    const slug = await circleOf(a);
    const other = await circleOf(s);
    await enrol(slug, b.id);
    const zed = await kidOf(s.id);
    const before = [await rowsOf(slug), await rowsOf(other)];
    expect(await removeMember(db, a.id, slug, { accountId: s.id, profileId: null }, NOW)).toBe('not_found');
    expect(await removeMember(db, a.id, other, { accountId: s.id, profileId: null }, NOW)).toBe('not_owner');
    expect(await removeMember(db, a.id, slug, { accountId: b.id, profileId: zed }, NOW)).toBe('not_found');
    expect(await transferOwnership(db, a.id, slug, s.id, NOW)).toBe('not_eligible');
    expect(await addChildToCircle(db, a.id, slug, zed, 'on', NOW)).toBe('not_allowed');
    expect(await removeChildFromCircle(db, a.id, other, zed, NOW)).toBe(false);
    const forged = await createCircleRequest(req({ name: 'Mine', kind: 'friends', your_name: 'B', account_id: s.id }, b.session), d());
    const made = /^\/circles\/([a-z0-9]{10})\//.exec(forged.headers.get('location') ?? '')![1];
    expect((await getCircleForMember(db, b.id, made))!.myRole).toBe('owner');
    expect(await getCircleForMember(db, s.id, made)).toBeNull();
    expect([await rowsOf(slug), await rowsOf(other)]).toEqual(before);
  });

  it('a circle with a child profile never gains a 13-17 member: no child beside a teen, no teen as owner', async () => {
    const a = await person();
    const teen = await person('2010-01-01');
    const slug = await circleOf(a);
    const kid = await kidOf(a.id);
    await enrol(slug, teen.id);
    expect(await addChildToCircle(db, a.id, slug, kid, 'on', NOW)).toBe('has_teen');
    expect(await transferOwnership(db, a.id, slug, teen.id, NOW)).toBe('not_eligible');
    const fam = await circleOf(a);
    expect(await addChildToCircle(db, a.id, fam, kid, 'on', NOW)).toBe('added');
    const id = (await db.query<{ id: string }>('SELECT id FROM circles WHERE slug = $1', [fam])).rows[0].id;
    expect(await circleHasChild(db, id)).toBe(true);
    for (const kind of ['friends', 'community']) {
      expect(await addChildToCircle(db, a.id, await circleOf(a, kind), kid, 'on', NOW)).toBe('not_family');
    }
    expect(await createCircle(db, teen.id, { name: 'Fam', kind: 'family', yourName: 'T' }, NOW)).toEqual({ status: 'not_allowed' });
  });

  it('an owner action by a plain member is denied', async () => {
    const a = await person();
    const b = await person();
    const slug = await circleOf(a);
    await enrol(slug, b.id);
    expect(await removeMember(db, b.id, slug, { accountId: a.id, profileId: null }, NOW)).toBe('not_owner');
    expect(await transferOwnership(db, b.id, slug, b.id, NOW)).toBe('not_owner');
    expect(await closeCircle(db, b.id, slug, NOW)).toBe('not_owner');
    const r = await closeCircleRequest(req({ confirm: 'on' }, b.session), d(), slug);
    expect(r.headers.get('location')).toBe(`/circles/${slug}/?r=not-owner#result`);
    expect(await getCircleForMember(db, a.id, slug)).toMatchObject({ status: 'open', myRole: 'owner' });
  });
});

describe('invites and communities (plan 4B, Task 3)', () => {
  const NOW = new Date('2026-11-05T12:00:00Z');
  let c = 0;
  const req = (body: Record<string, string>, cookie: string) =>
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
  const d = () => ({ db, now: NOW, limit: () => true, network: () => true, send: async () => undefined });
  const count = async (sql: string, p: unknown[]) => (await db.query<{ n: number }>(sql, p)).rows[0].n;
  async function person(dateOfBirth = '1984-02-02', consent?: Consent) {
    const email = `p4b-${c++}@example.test`;
    const parentEmail = dateOfBirth.startsWith('2012') ? `p4b-parent-${c++}@example.test` : undefined;
    const r = await signUp(db, { email, dateOfBirth, parentEmail }, T0);
    if (r.status !== 'created') throw new Error('sign-up failed');
    if (consent) await db.query('UPDATE accounts SET consent_state = $2 WHERE id = $1', [r.accountId, consent]);
    return { id: r.accountId, email, session: await signIn(email) };
  }
  async function circleOf(owner: { id: string }, kind = 'friends') {
    const r = await createCircle(db, owner.id, { name: 'Invite isolation', kind, yourName: 'Owner' }, T0);
    if (r.status !== 'created') throw new Error('circle failed');
    return r.slug;
  }
  async function linkOf(owner: { id: string }, slug: string) {
    const r = await createLinkInvite(db, owner.id, slug, NOW);
    if (r.status !== 'created') throw new Error('link failed');
    return r.token;
  }
  const invites = async () => (await db.query('SELECT id, circle_id, revoked_at, used_at FROM circle_invites ORDER BY id')).rows;
  const members = async (slug: string) =>
    (
      await db.query(
        'SELECT m.account_id, m.left_at FROM circle_members m JOIN circles x ON x.id = m.circle_id WHERE x.slug = $1 ORDER BY 1',
        [slug],
      )
    ).rows;
  const inviteOf = async (slug: string) =>
    (await db.query<{ id: string }>('SELECT i.id FROM circle_invites i JOIN circles x ON x.id = i.circle_id WHERE x.slug = $1', [slug]))
      .rows[0].id;

  beforeEach(() => {
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
    vi.stubEnv('CIRCLES_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('tampered token, circle and invite ids are denied and change nothing', async () => {
    const a = await person();
    const s = await person();
    const slug = await circleOf(a);
    const other = await circleOf(s);
    const token = await linkOf(a, slug);
    await linkOf(s, other);
    const before = [await invites(), await members(slug), await members(other)];
    const intruder = await person();
    const flipped = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    for (const t of [flipped, 'A'.repeat(43), `${token}=`, `${token.slice(0, 42)}`]) {
      expect(await previewInvite(db, t, NOW), t).toBeNull();
      expect(await acceptInvite(db, intruder.id, t, 'Ivy', NOW), t).toEqual({ status: 'invalid' });
    }
    // A circle id or slug in the form never redirects the join: the token decides.
    const r = await acceptInviteRequest(req({ your_name: 'Ivy', circle: other, slug: other }, intruder.session), d(), flipped);
    expect(r.status).toBe(404);
    // Another circle's invite id, through this circle's URL or by someone who is neither its owner nor its creator.
    const theirs = await inviteOf(other);
    expect(await revokeInvite(db, a.id, slug, theirs, NOW)).toBe(false);
    expect(await revokeInvite(db, a.id, other, theirs, NOW)).toBe(false);
    const viaUrl = await revokeInviteRequest(req({ invite_id: theirs }, a.session), d(), slug);
    expect(viaUrl.headers.get('location')).toBe(`/circles/${slug}/?r=revoke-gone#invites`);
    // A stranger to the URL circle gets the neutral answer whatever circle the form names.
    const made = await createLinkRequest(req({ circle: slug }, intruder.session), d(), other);
    expect(made.headers.get('location')).toBe('/circles/?r=gone#result');
    expect(await createLinkInvite(db, intruder.id, other, NOW)).toEqual({ status: 'not_allowed' });
    expect([await invites(), await members(slug), await members(other)]).toEqual(before);
  });

  it("account B cannot revoke account A's invite; A's own revocation works", async () => {
    const owner = await person();
    const a = await person();
    const b = await person();
    const slug = await circleOf(owner);
    for (const p of [a, b]) expect((await acceptInvite(db, p.id, await linkOf(owner, slug), 'M', NOW)).status).toBe('joined');
    await linkOf(a, slug);
    const id = (await db.query<{ id: string }>('SELECT id FROM circle_invites WHERE created_by = $1', [a.id])).rows[0].id;
    expect(await revokeInvite(db, b.id, slug, id, NOW)).toBe(false);
    const r = await revokeInviteRequest(req({ invite_id: id }, b.session), d(), slug);
    expect(r.headers.get('location')).toBe(`/circles/${slug}/?r=revoke-gone#invites`);
    expect(await revokeInvite(db, a.id, slug, id, NOW)).toBe(true);
  });

  it('13-15 account -> community join denied (library and route); a friends circle by invite allowed; pending denied', async () => {
    const owner = await person();
    const community = await circleOf(owner, 'community');
    const friends = await circleOf(owner);
    const teen = await person('2012-01-01', 'confirmed');
    expect(await joinCommunity(db, teen.id, community, 'Tia', NOW)).toEqual({ status: 'community_age' });
    const r = await joinCommunityRequest(req({ slug: community, your_name: 'Tia' }, teen.session), d());
    expect(r.headers.get('location')).toBe('/circles/communities/?r=community_age#result');
    expect(await acceptInvite(db, teen.id, await linkOf(owner, community), 'Tia', NOW)).toEqual({ status: 'community_age' });
    expect((await acceptInvite(db, teen.id, await linkOf(owner, friends), 'Tia', NOW)).status).toBe('joined');
    const pending = await person('2012-01-01');
    expect(await acceptInvite(db, pending.id, await linkOf(owner, friends), 'Pip', NOW)).toEqual({ status: 'capability' });
  });

  it('13-17 account -> a circle holding a child profile refused through an invite', async () => {
    const owner = await person();
    const fam = await circleOf(owner, 'family');
    const kid = await createChildProfile(db, owner.id, { displayName: 'Kid', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (kid.status !== 'created') throw new Error('profile failed');
    expect(await addChildToCircle(db, owner.id, fam, kid.profileId, 'on', NOW)).toBe('added');
    const token = await linkOf(owner, fam);
    for (const dob of ['2010-01-01', '2012-01-01']) {
      const teen = await person(dob, 'confirmed');
      expect(await acceptInvite(db, teen.id, token, 'Teen', NOW), dob).toEqual({ status: 'has_child_adults_only' });
    }
    expect((await acceptInvite(db, (await person()).id, token, 'Adult', NOW)).status).toBe('joined');
  });

  it('child profile context -> invite page shows no form; accept and every invite write denied', async () => {
    const owner = await person();
    const slug = await circleOf(owner);
    const token = await linkOf(owner, slug);
    const kid = await createChildProfile(db, owner.id, { displayName: 'Kid', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (kid.status !== 'created') throw new Error('profile failed');
    expect(await switchToProfile(db, owner.session, kid.profileId, NOW)).toBe(true);
    const before = [await invites(), await members(slug)];
    expect(await loadInvitePage(db, owner.session, token, NOW)).toMatchObject({ viewer: 'child' });
    expect((await acceptInviteRequest(req({ your_name: 'Kid' }, owner.session), d(), token)).status).toBe(403);
    expect((await createLinkRequest(req({}, owner.session), d(), slug)).status).toBe(403);
    expect((await emailInviteRequest(req({ email: 'x@example.test' }, owner.session), d(), slug)).status).toBe(403);
    expect((await revokeInviteRequest(req({ invite_id: await inviteOf(slug) }, owner.session), d(), slug)).status).toBe(403);
    expect((await joinCommunityRequest(req({ slug, your_name: 'Kid' }, owner.session), d())).status).toBe(403);
    expect([await invites(), await members(slug)]).toEqual(before);
  });

  it('deleting an account removes its invites, its referral row and pending invites to its address; others keep theirs', async () => {
    const owner = await person();
    const slug = await circleOf(owner);
    const fresh = await person();
    await db.query("UPDATE accounts SET created_at = $2::timestamptz - interval '5 minutes' WHERE id = $1", [fresh.id, NOW.toISOString()]);
    expect((await acceptInvite(db, fresh.id, await linkOf(owner, slug), 'F', NOW)).status).toBe('joined');
    await linkOf(fresh, slug);
    const target = await person();
    expect(await createEmailInvite(db, owner.id, slug, target.email, NOW, async () => undefined)).toBe('sent');
    expect(await count('SELECT count(*)::int AS n FROM referrals WHERE new_account_id = $1', [fresh.id])).toBe(1);
    expect(await deleteOwnAccount(db, fresh.id, fresh.email)).toBe('deleted');
    expect(await deleteOwnAccount(db, target.id, target.email)).toBe('deleted');
    expect(await count('SELECT count(*)::int AS n FROM circle_invites WHERE created_by = $1', [fresh.id])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM referrals WHERE new_account_id = $1', [fresh.id])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM circle_invites WHERE invited_email = $1', [target.email])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM circle_invites WHERE created_by = $1', [owner.id])).toBe(1);
  });
});

describe('circle sets and scores (plan 4C, Task 4)', () => {
  const NOW = new Date('2026-11-05T12:00:00Z');
  let c = 0;
  async function person() {
    const email = `p4c-${c++}@example.test`;
    const r = await signUp(db, { email, dateOfBirth: '1984-02-02' }, T0);
    if (r.status !== 'created') throw new Error('sign-up failed');
    return { id: r.accountId, session: await signIn(email) };
  }
  const enrol = (slug: string, accountId: string, name = 'M') =>
    db.query('INSERT INTO circle_members (circle_id, account_id, display_name) SELECT id, $2, $3 FROM circles WHERE slug = $1', [
      slug,
      accountId,
      name,
    ]);
  const idOf = async (slug: string) => (await db.query<{ id: string }>('SELECT id FROM circles WHERE slug = $1', [slug])).rows[0].id;
  const req = (body: Record<string, string>, cookie: string) =>
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
  let world: number;
  let adultsIds: string[];

  // Owner Ann with member Bob in a family circle, and a child profile of Ann's not yet in it.
  async function setup() {
    const ann = await person();
    const bob = await person();
    const r = await createCircle(db, ann.id, { name: 'Sets', kind: 'family', yourName: 'Ann' }, T0);
    if (r.status !== 'created') throw new Error('circle failed');
    await enrol(r.slug, bob.id, 'Bob');
    const kid = await createChildProfile(db, ann.id, { displayName: 'Kid', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (kid.status !== 'created') throw new Error('profile failed');
    return { ann, bob, slug: r.slug, id: await idOf(r.slug), kid: kid.profileId };
  }

  beforeAll(async () => {
    world = (await db.query<{ id: number }>("SELECT id FROM worlds WHERE slug = 'play'")).rows[0].id;
    adultsIds = [];
    for (let i = 0; i < 6; i++) adultsIds.push(await playItem(db, { world, audience: 'adults' }));
    for (let i = 0; i < 3; i++) await playItem(db, { world, audience: 'all' });
  });
  beforeEach(() => {
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
    vi.stubEnv('CIRCLES_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('child profile in a circle -> no adults item in the set or the scores, even when the stored set held one', async () => {
    const { ann, slug, id, kid } = await setup();
    const before = await getOrCreateDailySet(db, id, NOW);
    const adultsInSet = before.filter((s) => adultsIds.includes(s.itemId));
    expect(adultsInSet.length).toBeGreaterThan(0);
    await recordAnswer(db, { accountId: ann.id, profileId: null }, adultsInSet[0].itemId, true, NOW);
    expect((await getTallies(db, ann.id, null, slug, NOW))!.circleTotals.day).toBe(10);
    expect(await addChildToCircle(db, ann.id, slug, kid, 'on', NOW)).toBe('added');
    expect((await getOrCreateDailySet(db, id, NOW)).some((s) => adultsIds.includes(s.itemId))).toBe(false);
    expect((await getTallies(db, ann.id, null, slug, NOW))!.circleTotals.day).toBe(0);
    expect(await switchToProfile(db, ann.session, kid, NOW)).toBe(true);
    const page = await loadSetPage(db, ann.session, slug, NOW);
    expect(page.status === 'ok' && page.items.some((s) => adultsIds.includes(s.itemId))).toBe(false);
    const scores = await loadScoresPage(db, ann.session, slug, NOW);
    expect(scores.status === 'ok' && scores.tallies.circleTotals.day).toBe(0);
  });

  it('account B (not a member) and a non-member are denied the set, scores and notices', async () => {
    const { ann, slug } = await setup();
    const stranger = await person();
    expect(await getTallies(db, stranger.id, null, slug, NOW)).toBeNull();
    expect(await listNotices(db, stranger.id, slug, NOW)).toBeNull();
    expect(await getCircleInterests(db, stranger.id, slug)).toBeNull();
    expect(await loadSetPage(db, stranger.session, slug, NOW)).toEqual({ status: 'not_found' });
    expect(await loadScoresPage(db, stranger.session, slug, NOW)).toEqual({ status: 'not_found' });
    expect((await loadSetPage(db, ann.session, slug, NOW)).status).toBe('ok');
  });

  it('tampered circle slug, profile id or item id changes nothing', async () => {
    const { ann, bob, slug, id, kid } = await setup();
    // Bob with Ann's child's profile id, Ann with a profile not in the circle, a forged slug: no board.
    expect(await getTallies(db, bob.id, kid, slug, NOW)).toBeNull();
    expect(await getTallies(db, ann.id, kid, slug, NOW)).toBeNull();
    expect(await getTallies(db, ann.id, null, 'zzzzzzzzzz', NOW)).toBeNull();
    // A member posting interests with the owner's account id in the form: not the owner, nothing saved.
    const body = { world: String(world), account_id: ann.id, circle: slug };
    const r = await saveCircleInterestsRequest(req(body, bob.session), { db, now: NOW, limit: () => true }, slug);
    expect(r.headers.get('location')).toContain('r=not-owner');
    expect(await getCircleInterests(db, ann.id, slug)).toEqual({ worldIds: [], topicIds: [] });
    // A correct answer to a valid item that is not in the circle's set scores nothing.
    const set = (await getOrCreateDailySet(db, id, NOW)).map((s) => s.itemId);
    const outside = await playItem(db, { world, audience: 'all' });
    expect(set).not.toContain(outside);
    await recordAnswer(db, { accountId: bob.id, profileId: null }, outside, true, NOW);
    expect((await getTallies(db, ann.id, null, slug, NOW))!.circleTotals.allTime).toBe(0);
  });

  it('a left member is denied the set, scores and notices; a re-score notice reaches members only', async () => {
    const { ann, bob, slug, id } = await setup();
    const set = await getOrCreateDailySet(db, id, NOW);
    await recordAnswer(db, { accountId: bob.id, profileId: null }, set[0].itemId, false, NOW, 'a');
    await db.transaction((tx) => changeAnswerKey(tx, set[0].itemId, 'a', NOW));
    expect(await listNotices(db, bob.id, slug, NOW)).toHaveLength(1);
    expect(await leaveCircle(db, bob.id, slug, NOW)).toBe('left');
    expect(await getTallies(db, bob.id, null, slug, NOW)).toBeNull();
    expect(await listNotices(db, bob.id, slug, NOW)).toBeNull();
    expect(await loadSetPage(db, bob.session, slug, NOW)).toEqual({ status: 'not_found' });
    const board = (await getTallies(db, ann.id, null, slug, NOW))!.day;
    expect(board.find((r) => r.former)).toMatchObject({ name: 'Former member', points: 10 });
    await db.transaction((tx) => changeAnswerKey(tx, set[0].itemId, 'b', NOW));
  });
});

describe('circle mail, reports and share prompts (plan 4D, Task 3)', () => {
  const NOW = new Date('2026-11-05T12:00:00Z');
  const LINKS = { base: 'https://staging.sparkkindly.com', secret: 'test-only-unsubscribe-secret-0123456789abcdef' };
  const CAP = { mails: 200, circles: 50 };
  let c = 0;
  let world: number;
  async function person() {
    const email = `p4d-${c++}@example.test`;
    const r = await signUp(db, { email, dateOfBirth: '1984-02-02' }, T0);
    if (r.status !== 'created') throw new Error('sign-up failed');
    const session = await signIn(email);
    await db.query('UPDATE accounts SET notify_daily_set = true, notify_weekly_circle = true WHERE id = $1', [r.accountId]);
    return { id: r.accountId, email, session };
  }
  const req = (body: Record<string, string>, cookie: string, url = 'http://localhost/x') =>
    new Request(url, {
      method: 'POST',
      headers: {
        host: 'staging.sparkkindly.com',
        origin: 'https://staging.sparkkindly.com',
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: new URLSearchParams(body).toString(),
    });
  // Ann's family circle with member Bob and a child profile of Ann's (not yet in it), and Cat in a circle of her own.
  async function setup() {
    const ann = await person();
    const bob = await person();
    const cat = await person();
    const r = await createCircle(db, ann.id, { name: 'Mail', kind: 'family', yourName: 'Ann' }, T0);
    const other = await createCircle(db, cat.id, { name: 'Other', kind: 'friends', yourName: 'Cat' }, T0);
    if (r.status !== 'created' || other.status !== 'created') throw new Error('circle failed');
    await db.query("INSERT INTO circle_members (circle_id, account_id, display_name) SELECT id, $2, 'Bob' FROM circles WHERE slug = $1", [
      r.slug,
      bob.id,
    ]);
    const kid = await createChildProfile(db, ann.id, { displayName: 'Kid', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (kid.status !== 'created') throw new Error('profile failed');
    const id = (await db.query<{ id: string }>('SELECT id FROM circles WHERE slug = $1', [r.slug])).rows[0].id;
    return { ann, bob, cat, slug: r.slug, id, kid: kid.profileId };
  }

  beforeAll(async () => {
    world = (await db.query<{ id: number }>("SELECT id FROM worlds WHERE slug = 'play'")).rows[0].id;
  });
  beforeEach(() => {
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
    vi.stubEnv('CIRCLES_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('account B and non-members get no mail for circle A; members get only their own circle mail', async () => {
    const { ann, bob, cat, id } = await setup();
    const batches = await weeklyMailFor(db, new Date('2026-11-09T09:00:00Z'), CAP, LINKS);
    const forA = batches.find((b) => b.claim.circleId === id);
    expect(forA?.mails.map((m) => m.to).sort()).toEqual([ann.email, bob.email].sort());
    for (const b of batches) {
      for (const m of b.mails) if (m.to === cat.email) expect(m.claim.circleId).not.toBe(id);
      if (b.claim.circleId !== id) expect(b.mails.map((m) => m.to)).not.toContain(ann.email);
    }
    expect(await dailyMailFor(db, new Date('2026-11-05T08:00:00Z'), CAP, { ...LINKS, secret: '' })).toEqual([]);
  });

  it('child profile -> adults item denied at the email: the weekly summary scores it nothing while a child is in', async () => {
    const { ann, slug, id, kid } = await setup();
    const adultsItem = await playItem(db, { world, audience: 'adults' });
    await db.query("INSERT INTO circle_daily_sets (circle_id, day, position, item_id) VALUES ($1, '2026-11-04', 1, $2)", [id, adultsItem]);
    await recordAnswer(db, { accountId: ann.id, profileId: null }, adultsItem, true, new Date('2026-11-04T12:00:00Z'));
    const mine = async () =>
      (await weeklyMailFor(db, new Date('2026-11-09T09:00:00Z'), CAP, LINKS))
        .find((b) => b.claim.circleId === id)!
        .mails.find((m) => m.to === ann.email)!.text;
    expect(await mine()).toMatch(/You: rank 1, 10 points/);
    expect(await addChildToCircle(db, ann.id, slug, kid, 'on', NOW)).toBe('added');
    expect(await mine()).toMatch(/You: rank 1, 0 points/);
  });

  it('account B cannot report circle A; a child context is denied the report route', async () => {
    const { ann, cat, slug, kid } = await setup();
    expect(await reportCircle(db, cat.id, slug, { reason: 'safety' }, NOW)).toBe('not_member');
    const deps = { db, now: NOW, limit: () => true };
    const viaRoute = await reportCircleRequest(req({ reason: 'safety' }, `__Host-sk_account=${cat.session}`), deps, slug);
    expect(viaRoute.headers.get('location')).toBe('/circles/?r=gone#result');
    expect(await switchToProfile(db, ann.session, kid, NOW)).toBe(true);
    expect((await reportCircleRequest(req({ reason: 'safety' }, `__Host-sk_account=${ann.session}`), deps, slug)).status).toBe(403);
    expect((await db.query('SELECT count(*)::int AS n FROM circle_reports')).rows[0].n).toBe(0);
  });

  it('a member account session gets no admin data or action (hide refused, sent to admin sign-in)', async () => {
    const { bob, id } = await setup();
    const r = await handleAdminAction(
      req({ action: 'circle.hide', id, csrf: 'x' }, `__Host-sk_account=${bob.session}`, 'http://localhost/admin/act/'),
      { db, env: { ADMIN_EMAILS: bob.email }, now: NOW },
    );
    expect([r.status, r.headers.get('location')]).toEqual([303, '/admin/sign-in/']);
    expect((await db.query('SELECT hidden_at FROM circles WHERE id = $1', [id])).rows[0].hidden_at).toBeNull();
  });

  it('share prompt: account B, non-members and a child context get none', async () => {
    const { ann, cat, id, kid } = await setup();
    const quiz = await playItem(db, { world, audience: 'all' });
    await db.query("INSERT INTO circle_daily_sets (circle_id, day, position, item_id) VALUES ($1, '2026-11-05', 1, $2)", [id, quiz]);
    expect(await sharePromptFor(db, (await getContext(db, ann.session, NOW))!, quiz, NOW, LINKS.base)).not.toBeNull();
    expect(await sharePromptFor(db, (await getContext(db, cat.session, NOW))!, quiz, NOW, LINKS.base)).toBeNull();
    expect(await switchToProfile(db, ann.session, kid, NOW)).toBe(true);
    expect(await sharePromptFor(db, (await getContext(db, ann.session, NOW))!, quiz, NOW, LINKS.base)).toBeNull();
  });
});

describe('comments (plan 7A, Task 3)', () => {
  const NOW = new Date('2026-11-05T12:00:00Z');
  let c = 0;
  let world: number;
  async function person(dateOfBirth = '1984-02-02', parentEmail?: string) {
    const email = `p7a-${c++}@example.test`;
    const r = await signUp(db, { email, dateOfBirth, parentEmail }, T0);
    if (r.status !== 'created') throw new Error('sign-up failed');
    const session = await signIn(email);
    return { id: r.accountId, email, session, ctx: (await getContext(db, session, NOW))! };
  }
  const req = (path: string, body: Record<string, string>, session?: string) =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        host: 'staging.sparkkindly.com',
        origin: 'https://staging.sparkkindly.com',
        'content-type': 'application/x-www-form-urlencoded',
        ...(session ? { cookie: `__Host-sk_account=${session}` } : {}),
      },
      body: new URLSearchParams(body).toString(),
    });
  const deps = () => ({ db, now: NOW });
  const first = { displayName: 'Sam', guidelines: 'on' };
  const comments = async () => (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM comments')).rows[0].n;
  async function child(p: { id: string; session: string }) {
    const kid = await createChildProfile(db, p.id, { displayName: 'Kid', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (kid.status !== 'created') throw new Error('profile failed');
    expect(await switchToProfile(db, p.session, kid.profileId, NOW)).toBe(true);
  }

  beforeAll(async () => {
    world = (await db.query<{ id: number }>("SELECT id FROM worlds WHERE slug = 'play'")).rows[0].id;
  });
  beforeEach(() => {
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
    vi.stubEnv('COMMENTS_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('child profile -> comments denied: no section, no post (route 403), no list', async () => {
    const quiz = await playItem(db, { world, audience: 'all' });
    const p = await person();
    await child(p);
    const before = await comments();
    expect(await loadCommentSection(db, p.session, quiz, NOW)).toBeNull();
    const r = await postCommentRequest(req('/comments/post/', { item: quiz, body: 'hi', display_name: 'Kid', guidelines: 'on' }, p.session), deps());
    expect(r.status).toBe(403);
    const ctx = (await getContext(db, p.session, NOW))!;
    expect(await postComment(db, ctx, { itemId: quiz, body: 'hi', ...first }, NOW)).toEqual({ status: 'refused', code: 'not_allowed' });
    expect(await comments()).toBe(before);
  });

  it('13-15 account -> public comment denied (route and repo), with consent confirmed', async () => {
    const quiz = await playItem(db, { world, audience: 'all' });
    const teen = await person('2012-01-01', `parent-7a-${c++}@example.test`);
    await db.query("UPDATE accounts SET consent_state = 'confirmed' WHERE id = $1", [teen.id]);
    const r = await postCommentRequest(req('/comments/post/', { item: quiz, body: 'hello', display_name: 'Tee', guidelines: 'on' }, teen.session), deps());
    expect(r.headers.get('location')).toMatch(/\?c=not_allowed#result$/);
    const ctx = (await getContext(db, teen.session, NOW))!;
    expect(await postComment(db, ctx, { itemId: quiz, body: 'hello', ...first }, NOW)).toEqual({ status: 'refused', code: 'not_allowed' });
  });

  it('anonymous -> cannot post (sent to sign in)', async () => {
    const quiz = await playItem(db, { world, audience: 'all' });
    const r = await postCommentRequest(req('/comments/post/', { item: quiz, body: 'hello' }), deps());
    expect([r.status, r.headers.get('location')]).toEqual([303, '/account/sign-in/']);
  });

  it('account B cannot edit or delete account A comments; tampered comment ids change nothing', async () => {
    const quiz = await playItem(db, { world, audience: 'all' });
    const a = await person();
    const b = await person();
    const posted = await postComment(db, a.ctx, { itemId: quiz, body: 'A words', ...first }, NOW);
    if (posted.status === 'refused') throw new Error('refused');
    expect(await editComment(db, b.id, posted.id, 'B words', NOW)).toBe('not_found');
    expect(await deleteComment(db, b.id, posted.id, NOW)).toBe(false);
    await editCommentRequest(req('/comments/edit/', { item: quiz, comment: posted.id, body: 'B words', account: a.id }, b.session), deps());
    await deleteCommentRequest(req('/comments/delete/', { item: quiz, comment: posted.id, account: a.id }, b.session), deps());
    for (const id of ['nope', '00000000-0000-0000-0000-000000000001']) {
      expect(await editComment(db, a.id, id, 'x', NOW)).toBe('not_found');
      expect(await deleteComment(db, a.id, id, NOW)).toBe(false);
    }
    const row = (await db.query('SELECT status, body FROM comments WHERE id = $1', [posted.id])).rows[0];
    expect(row).toEqual({ status: 'held', body: 'A words' });
  });

  it('tampered item and parent ids are denied; a reply cannot cross items', async () => {
    const quiz = await playItem(db, { world, audience: 'all' });
    const other = await playItem(db, { world, audience: 'all' });
    const a = await person();
    await db.transaction((tx) => setTrust(tx, a.id, { level: 1 }));
    const top = await postComment(db, a.ctx, { itemId: quiz, body: 'top words', ...first }, NOW);
    if (top.status === 'refused') throw new Error('refused');
    for (const itemId of ['nope', '00000000-0000-0000-0000-000000000001']) {
      expect(await postComment(db, a.ctx, { itemId, body: 'x words' }, NOW)).toEqual({ status: 'refused', code: 'no_item' });
    }
    expect(await postComment(db, a.ctx, { itemId: other, parentId: top.id, body: 'cross words' }, NOW)).toEqual({ status: 'refused', code: 'no_parent' });
    expect(await postComment(db, a.ctx, { itemId: quiz, parentId: 'nope', body: 'bad words' }, NOW)).toEqual({ status: 'refused', code: 'no_parent' });
  });

  it('held, hidden, rejected and deleted comments never reach another viewer', async () => {
    const quiz = await playItem(db, { world, audience: 'all' });
    const a = await person();
    const b = await person();
    for (const status of ['held', 'hidden', 'rejected']) {
      await db.query('INSERT INTO comments (item_id, account_id, body, status) VALUES ($1, $2, $3, $4)', [quiz, a.id, `${status} words`, status]);
    }
    await db.query("INSERT INTO comments (item_id, account_id, body, status) VALUES ($1, $2, '', 'deleted')", [quiz, a.id]);
    expect(await listPublishedComments(db, quiz, NOW, b.id)).toEqual([]);
    const section = await loadCommentSection(db, b.session, quiz, NOW);
    expect(section!.comments).toEqual([]);
    expect(section!.pending).toEqual([]);
    expect(JSON.stringify(await loadCommentSection(db, undefined, quiz, NOW))).not.toMatch(/held words|hidden words|rejected words/);
  });
});

describe('comment moderation (plan 7B, Task 4)', () => {
  const NOW = new Date('2026-11-05T12:00:00Z');
  const SECRET = 'isolation-test-only-appeal-secret-000001';
  let c = 0;
  async function person() {
    const email = `p7b-${c++}@example.test`;
    const r = await signUp(db, { email, dateOfBirth: '1984-02-02' }, T0);
    if (r.status !== 'created') throw new Error('sign-up failed');
    return { id: r.accountId, email, session: await signIn(email) };
  }
  async function rejectedComment() {
    const a = await person();
    const quiz = await playItem(db, { world: (await db.query<{ id: number }>("SELECT id FROM worlds WHERE slug = 'play'")).rows[0].id, audience: 'all' });
    const r = await db.query<{ id: string }>(
      "INSERT INTO comments (item_id, account_id, body, status, moderation_reason) VALUES ($1, $2, 'A rejected words', 'rejected', 'Rude') RETURNING id",
      [quiz, a.id],
    );
    return { a, id: r.rows[0].id };
  }
  beforeEach(() => {
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
    vi.stubEnv('COMMENTS_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("account B cannot appeal or read account A's rejection, even with a token naming A's comment", async () => {
    const { a, id } = await rejectedComment();
    const b = await person();
    const forged = appealToken(SECRET, id, b.id, NOW)!;
    expect(await appealState(db, SECRET, forged, NOW)).toBe('invalid');
    expect(await fileAppeal(db, SECRET, forged, 'mine', NOW)).toBe('invalid');
    const tampered = appealToken(SECRET, id, a.id, NOW)!.replace(a.id, b.id);
    expect(await fileAppeal(db, SECRET, tampered, 'mine', NOW)).toBe('invalid');
    expect((await db.query('SELECT count(*)::int AS n FROM comment_appeals')).rows[0].n).toBe(0);
  });

  it('a non-owner cannot decide appeals: an account session at /admin/act/ goes to admin sign-in', async () => {
    const { a, id } = await rejectedComment();
    expect(await fileAppeal(db, SECRET, appealToken(SECRET, id, a.id, NOW)!, '', NOW)).toBe('filed');
    const r = await handleAdminAction(
      new Request('http://localhost/admin/act/', {
        method: 'POST',
        headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/x-www-form-urlencoded', cookie: `__Host-sk_account=${a.session}` },
        body: new URLSearchParams({ action: 'comments.appeal_overturn', comment: id, csrf: 'x' }).toString(),
      }),
      { db, env, now: NOW },
    );
    expect(r.headers.get('location')).toBe('/admin/sign-in/');
    expect((await db.query('SELECT status FROM comments WHERE id = $1', [id])).rows[0].status).toBe('rejected');
  });

  it('a content-role agent key is refused on the moderation routes', async () => {
    const { key } = await createAgent(db, `content-7b-${c++}`, null);
    const d = { db, now: NOW, env: {}, send: async () => ({}), limiter: createLimiter({ perMinute: 60 }) };
    const get = await queueRequest(new Request('http://localhost/api/agent/moderation/', { headers: { 'x-agent-key': key } }), d);
    const post = await decideRequest(new Request('http://localhost/api/agent/moderation/decide/', { method: 'POST', headers: { 'x-agent-key': key }, body: '{}' }), d);
    expect([get.status, post.status]).toEqual([403, 403]);
  });

  it('a child context cannot report (403, nothing stored)', async () => {
    const parent = await person();
    const { id } = await rejectedComment();
    await db.query("UPDATE comments SET status = 'published' WHERE id = $1", [id]);
    const kid = await createChildProfile(db, parent.id, { displayName: 'Kid', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (kid.status !== 'created') throw new Error('profile failed');
    await switchToProfile(db, parent.session, kid.profileId, NOW);
    const r = await reportCommentRequest(
      new Request('http://localhost/comments/report/', {
        method: 'POST',
        headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/x-www-form-urlencoded', cookie: `__Host-sk_account=${parent.session}` },
        body: new URLSearchParams({ comment: id, reason: 'abuse' }).toString(),
      }),
      { db, now: NOW, env: {}, send: async () => ({}) },
    );
    expect(r.status).toBe(403);
    expect((await db.query('SELECT count(*)::int AS n FROM comment_reports')).rows[0].n).toBe(0);
  });
});

// Rows that arrived with later features, and where each is covered:
// The public reads take the session scope and /me the context audiences (both tested above); later routes add their own row.
// child profile -> adults item denied at the daily set and scores: covered above (plan 4C, Task 4).
// child profile -> adults item denied at the email: covered above (plan 4D, Task 3); the daily mail names no item at all.
// child profile -> settings, export, delete and PIN reset denied: covered above (plan 3E, Task 4).
// child profile -> invites denied: covered above (plan 4B, Task 3).
// child profile -> comments denied: covered above (plan 7A, Task 3); reporting: covered above (plan 7B, Task 4).
// child profile -> contribute routes denied: covered below (plan 8, Task 4).
// 13-15 account -> community join denied at the route: covered above (plan 4B, Task 3).
// 13-15 account -> public comment denied at the route: covered above (plan 7A, Task 3).
// 13-15 account -> contribute denied at the route: covered below (plan 8, Task 4).
// tampered item id at the daily set: an answer to an item outside the set scores nothing, covered above (plan 4C, Task 4).
// 13-17 account joining a circle that holds a child profile: covered above (plan 4B, Task 3).
// agent key A -> agent B's items denied: covered in tests/unit/agent-api.test.ts and agent-keys.test.ts, not duplicated here.

describe('contributors (plan 8): adult context, own contributions only', () => {
  const NOW8 = new Date('2026-11-05T12:00:00Z');
  const form = (path: string, session: string, fields: Record<string, string>) =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/x-www-form-urlencoded', cookie: `__Host-sk_account=${session}` },
      body: new URLSearchParams(fields).toString(),
    });
  beforeEach(async () => {
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
    vi.stubEnv('CONTRIBUTORS_ENABLED', 'true');
    await seedReference(db);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('child profile -> every contribute route is 403 and nothing is stored', async () => {
    const parent = await contributorFixture(db, NOW8);
    const kid = await createChildProfile(db, parent.id, { displayName: 'Kid', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (kid.status !== 'created') throw new Error('profile failed');
    await switchToProfile(db, parent.session, kid.profileId, NOW8);
    for (const fn of [enableRequest, saveRequest, submitRequest, withdrawRequest]) {
      expect((await fn(form('/me/contribute/x/', parent.session, { display_name: 'Kid', terms: 'on', kind: 'article', world: 'play' }), { db, now: NOW8 })).status).toBe(403);
    }
    expect((await db.query('SELECT count(*)::int AS n FROM contributions WHERE account_id = $1', [parent.id])).rows[0].n).toBe(0);
  });

  it('13-15 account -> contribute refused at the route (no profile, nothing stored)', async () => {
    const teen = await personFixture(db, NOW8, '2012-06-01', `p${Math.random()}@example.test`);
    const r = await enableRequest(form('/me/contribute/enable/', teen.session, { display_name: 'Teen', terms: 'on' }), { db, now: NOW8 });
    expect(r.headers.get('location')).toBe('/me/contribute/?r=not_allowed#result');
    expect((await db.query('SELECT 1 FROM contributor_profiles WHERE account_id = $1', [teen.id])).rows).toHaveLength(0);
  });

  it("account A -> account B's contribution denied (read, save, submit, withdraw), even with B's valid id", async () => {
    const a = await contributorFixture(db, NOW8);
    const b = await contributorFixture(db, NOW8);
    const id = await draftedFixture(db, b, NOW8);
    expect(await getMine(db, a.id, id)).toBeNull();
    for (const [fn, fields] of [
      [saveRequest, { id, kind: 'article', world: 'discover', title: 'Hijack' }],
      [submitRequest, { id, original: 'on', licence: 'on' }],
      [withdrawRequest, { id }],
    ] as const) {
      const r = await fn(form('/me/contribute/x/', a.session, fields), { db, now: NOW8 });
      expect(r.headers.get('location')).toBe('/me/contribute/?r=not_found#result');
    }
    expect((await getMine(db, b.id, id))!.state).toBe('draft');
  });
});

describe('sponsorship (plan 6): child, teen and unknown viewers never see it', () => {
  const NOW6 = new Date('2026-11-05T12:00:00Z');
  let itemId: string;
  let shipId: number;
  beforeEach(async () => {
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
    vi.stubEnv('SPONSORSHIP_ENABLED', 'true');
    await seedReference(db);
    itemId = (
      await db.query<{ id: string }>(
        `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
         SELECT id, 'article', $1, 'T', 'S', '{}'::jsonb, 'adults', 'published', '2026-11-01T00:00:00Z', 'test', 'reflective', 'owner'
         FROM worlds WHERE slug = 'grow' RETURNING id`,
        [`iso-sponsored-${Math.random().toString(36).slice(2, 8)}`],
      )
    ).rows[0].id;
    const sponsor = (await db.query<{ id: number }>("INSERT INTO sponsors (name, link, category, confirmed_at) VALUES ('Iso Sponsor', 'https://iso.example/', 'books', now()) RETURNING id")).rows[0].id;
    shipId = (await db.query<{ id: number }>("INSERT INTO sponsorships (sponsor_id, item_id, label) VALUES ($1, $2, 'Iso link') RETURNING id", [sponsor, itemId])).rows[0].id;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const go = (session: string) => new Request(`http://localhost/go/${shipId}/`, { headers: { cookie: `__Host-sk_account=${session}` } });
  const clicks = async () => (await db.query<{ c: number }>('SELECT click_count AS c FROM sponsorships WHERE id = $1', [shipId])).rows[0].c;

  it('own adult context -> the line; child profile, 16-17 and 13-15 accounts -> no line and no redirect', async () => {
    const adult = await personFixture(db, NOW6);
    expect(await loadSponsorLine(db, adult.session, itemId, NOW6)).toMatchObject({ id: shipId });
    const parent = await personFixture(db, NOW6);
    const kid = await createChildProfile(db, parent.id, { displayName: 'Kid', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (kid.status !== 'created') throw new Error('profile failed');
    await switchToProfile(db, parent.session, kid.profileId, NOW6);
    const older = await personFixture(db, NOW6, '2010-01-01');
    const younger = await personFixture(db, NOW6, '2012-06-01', `p${Math.random()}@example.test`);
    for (const s of [parent.session, older.session, younger.session]) {
      expect(await loadSponsorLine(db, s, itemId, NOW6)).toBeNull();
      expect((await clickRequest(go(s), { db, now: NOW6 }, String(shipId))).headers.get('location')).toBe('/');
    }
    expect(await clicks()).toBe(0);
  });

  it('a session lookup that fails -> unknown: no line', async () => {
    const broken = { query: () => Promise.reject(new Error('down')) } as unknown as typeof db;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await loadSponsorLine(broken, 'a'.repeat(64), itemId, NOW6)).toBeNull();
    spy.mockRestore();
  });
});

describe('video jobs (plan 5B): the promoter key stays in its lane, media is never public, Kids is never briefed', () => {
  const NOW5 = new Date('2026-11-05T09:00:00Z');
  const limiter = () => createLimiter({ perMinute: 600 });
  beforeEach(async () => {
    vi.stubEnv('SOCIAL_ENABLED', 'true');
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
    await seedReference(db);
    await db.query("UPDATE social_platforms SET enabled = true, daily_cap = 5 WHERE platform IN ('tiktok', 'youtube')");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const video = async (world: string, audience = 'all') =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
         SELECT id, 'video_script', $2, 'Iso video', 'S', '{}'::jsonb, $3, 'published', '2026-11-05T08:00:00Z', 'test', $4, 'owner'
         FROM worlds WHERE slug = $1 RETURNING id`,
        [world, `iso-video-${Math.random().toString(36).slice(2, 8)}`, audience, world === 'kids' || audience === 'kids' ? 'kids' : 'reflective'],
      )
    ).rows[0].id;
  const upload = (id: number, headers: Record<string, string>) =>
    handleVideoUpload(
      new Request(`http://localhost/admin/social/videos/${id}/upload/`, {
        method: 'POST',
        headers: { host: 'localhost', origin: 'http://localhost', 'x-upload-kind': 'video', 'x-file-name': 'a.mp4', 'x-declared-size': '4', ...headers },
        body: new Uint8Array(4),
      }),
      { db, env: {}, now: NOW5, jobId: String(id), probe: async () => null },
    );

  it('Kids video scripts (world or audience) never get a job; a Kids job planted by hand is never offered or briefed', async () => {
    const kidsWorld = await video('kids');
    const kidsAudience = await video('play', 'kids');
    await db.query("DELETE FROM job_runs WHERE job = 'social-select'");
    await selectVideos(db, 'tiktok', '2026-11-05', NOW5);
    const jobs = await db.query('SELECT 1 FROM video_jobs WHERE item_id = ANY($1::uuid[])', [[kidsWorld, kidsAudience]]);
    expect(jobs.rows).toEqual([]);
    const d = (await db.query<{ id: string }>("INSERT INTO distributions (item_id, platform, day, status) VALUES ($1, 'youtube', '2026-11-05', 'selected') RETURNING id", [kidsWorld])).rows[0].id;
    const j = Number((await db.query<{ id: string }>("INSERT INTO video_jobs (item_id, platform, distribution_id) VALUES ($1, 'youtube', $2) RETURNING id", [kidsWorld, d])).rows[0].id);
    const { key } = await createAgent(db, `iso-promoter-${Math.random().toString(36).slice(2, 8)}`, null, 'promoter');
    const get = new Request('http://localhost/api/agent/promotions/', { headers: { 'x-agent-key': key } });
    const { entries } = (await (await promotionsQueueRequest(get, { db, now: NOW5, site: 'https://sparkkindly.com', limiter: limiter() })).json()) as { entries: { id: number; kind: string }[] };
    expect(entries.filter((e) => e.kind === 'video_script').map((e) => e.id)).not.toContain(j);
    const brief = {
      id: j, version: 1, narration: 'n', shots: ['a', 'b', 'c'], onScreenText: [], captions: { youtube: { title: 't', description: 'd' } }, hashtags: [], durationSeconds: 20,
    };
    const post = new Request('http://localhost/api/agent/promotions/brief/', { method: 'POST', headers: { 'x-agent-key': key, 'content-type': 'application/json' }, body: JSON.stringify(brief) });
    const r = await briefRequest(post, { db, now: NOW5, site: 'https://sparkkindly.com', limiter: limiter() });
    expect(r.status).toBe(409);
    expect((await db.query<{ state: string }>('SELECT state FROM video_jobs WHERE id = $1', [j])).rows[0].state).toBe('cancelled');
  });

  it('the upload route refuses an agent key, a member session and no session; the promoter key is refused on the content API', async () => {
    const item = await video('play');
    const d = (await db.query<{ id: string }>("INSERT INTO distributions (item_id, platform, day, status) VALUES ($1, 'tiktok', '2026-11-05', 'copy_ready') RETURNING id", [item])).rows[0].id;
    const j = Number((await db.query<{ id: string }>("INSERT INTO video_jobs (item_id, platform, distribution_id, state) VALUES ($1, 'tiktok', $2, 'brief_ready') RETURNING id", [item, d])).rows[0].id);
    const { key } = await createAgent(db, `iso-promoter-${Math.random().toString(36).slice(2, 8)}`, null, 'promoter');
    const member = await personFixture(db, NOW5);
    for (const headers of [{ 'x-agent-key': key }, { cookie: `__Host-sk_account=${member.session}` }, {}] as Record<string, string>[]) {
      expect((await upload(j, headers)).status).toBe(401);
    }
    const content = await agentRoute(new Request('http://localhost/api/agent/brief/', { headers: { 'x-agent-key': key } }), async () => ({ status: 200, json: {} }), { db, limiter: limiter() });
    expect(content.status).toBe(403);
    expect((await db.query<{ file_name: string | null }>('SELECT file_name FROM video_jobs WHERE id = $1', [j])).rows[0].file_name).toBeNull();
  });
});
