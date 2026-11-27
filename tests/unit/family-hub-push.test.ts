// @vitest-environment node
// Family Hub Web Push (Phase 2.5): subscription ownership, the dormant-without-keys
// guarantee, and the run triggers. A capturing fake sender stands in for the real push
// service throughout — no test ever touches a network push endpoint. Payloads are
// asserted to carry kid first names and times only: the run's LOCATION must never leak
// into a notification.
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import {
  acceptInvite, claimRun, createCircle, createEvent, createInvite, createKid, releaseRun, updateEvent,
} from '@/lib/family-hub/repo';
import {
  countSubscriptions, notifyRunUncovered, removeSubscription, saveSubscription, sendPushToUsers, sendTestPush,
  setPushSenderForTests, type PushPayload, type StoredSubscription,
} from '@/lib/family-hub/push';
import { pushSubscribeRequest, pushUnsubscribeRequest } from '@/lib/family-hub/push-web';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-27T12:00:00Z');
let n = 0;

beforeAll(async () => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  db = await newTestDb();
});
afterAll(async () => {
  setPushSenderForTests(null);
  vi.unstubAllEnvs();
  await db.close();
});
afterEach(() => {
  setPushSenderForTests(null);
});

async function adult(): Promise<{ id: string; email: string; session: string }> {
  const email = `push${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: '1990-05-05' }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, T0))!, T0))!;
  return { id: r.accountId, email, session };
}

const mustId = (r: unknown): string => {
  if (typeof r !== 'object' || r === null || !('id' in r)) throw new Error('expected an id result');
  return (r as { id: string }).id;
};

type Sent = { userId: string; endpoint: string; payload: PushPayload };
const capture = (): { sent: Sent[]; sender: (sub: StoredSubscription, payload: PushPayload) => Promise<void> } => {
  const sent: Sent[] = [];
  return {
    sent,
    sender: async (sub, payload) => {
      sent.push({ userId: sub.userId, endpoint: sub.endpoint, payload });
    },
  };
};

const sub = (who: string) => ({ endpoint: `https://push.example/${who}`, p256dh: `pk-${who}`, auth: `auth-${who}` });

const runInput = (over: Record<string, unknown> = {}) => ({
  title: 'School pickup',
  startsAt: new Date('2026-11-27T20:00:00Z'),
  endsAt: new Date('2026-11-27T20:30:00Z'),
  recurrence: null,
  recurrenceUntil: null,
  location: 'Riverside Elementary',
  notes: null,
  isRun: true,
  driverUserId: null,
  memberIds: [],
  kidIds: [],
  ...over,
});

async function family(): Promise<{ a: Awaited<ReturnType<typeof adult>>; b: Awaited<ReturnType<typeof adult>>; circleId: string; kidId: string }> {
  const a = await adult();
  const b = await adult();
  const circleId = mustId(await createCircle(db, a.id, 'The Push Family', 'America/New_York'));
  const inv = await createInvite(db, circleId, a.id, null, T0);
  if (!inv) throw new Error('invite failed');
  const joined = await acceptInvite(db, inv.token, b.id, b.email, T0);
  if (joined.result !== 'joined') throw new Error('join failed');
  const kid = await createKid(db, circleId, a.id, { firstName: 'Maya', ageGroup: '6-8', avatarId: 'spark', colour: 'purple', phone: null });
  if (typeof kid !== 'object' || kid === null) throw new Error('kid failed');
  return { a, b, circleId, kidId: kid.id };
}

describe('subscriptions', () => {
  it('validates the endpoint and keys', async () => {
    const a = await adult();
    expect(await saveSubscription(db, a.id, { endpoint: 'http://insecure.example/x', p256dh: 'k', auth: 's' }, null)).toBe(false);
    expect(await saveSubscription(db, a.id, { endpoint: 'https://push.example/ok', p256dh: '', auth: 's' }, null)).toBe(false);
    expect(await saveSubscription(db, a.id, sub('valid'), 'TestAgent/1.0')).toBe(true);
    expect(await countSubscriptions(db, a.id)).toBe(1);
  });

  it("a user cannot remove another user's subscription", async () => {
    const a = await adult();
    const b = await adult();
    await saveSubscription(db, a.id, sub('owner-a'), null);
    await saveSubscription(db, b.id, sub('owner-b'), null);
    expect(await removeSubscription(db, a.id, 'https://push.example/owner-b')).toBe(false);
    expect(await countSubscriptions(db, b.id)).toBe(1);
    expect(await removeSubscription(db, b.id, 'https://push.example/owner-b')).toBe(true);
    expect(await countSubscriptions(db, b.id)).toBe(0);
  });
});

describe('dormant without VAPID keys', () => {
  it('every push path no-ops silently', async () => {
    const { a, circleId, kidId } = await family();
    await saveSubscription(db, a.id, sub('dormant'), null);
    // No env keys stubbed and no fake sender: sends report zero, notifications resolve.
    expect(await sendPushToUsers(db, [a.id], { title: 't', body: 'b', url: '/family/' })).toBe(0);
    expect(await sendTestPush(db, a.id)).toBe(0);
    const runId = mustId(await createEvent(db, circleId, a.id, runInput({ kidIds: [kidId] })));
    await expect(notifyRunUncovered(db, circleId, runId, a.id)).resolves.toBeUndefined();
  });
});

describe('run triggers', () => {
  beforeEach(() => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'test-public-key');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'test-private-key');
    vi.stubEnv('VAPID_SUBJECT', 'mailto:test@example.test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  });

  it('uncovered on create notifies the other adults only, first names and time, never the location', async () => {
    const { a, b, circleId, kidId } = await family();
    const stranger = await adult();
    await saveSubscription(db, a.id, sub('trig-a'), null);
    await saveSubscription(db, b.id, sub('trig-b'), null);
    await saveSubscription(db, stranger.id, sub('trig-c'), null);
    const { sent, sender } = capture();
    setPushSenderForTests(sender);
    await createEvent(db, circleId, a.id, runInput({ kidIds: [kidId] }));
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe(b.id);
    expect(sent[0].payload.title).toBe('A run needs a driver');
    expect(sent[0].payload.body).toContain('Maya');
    expect(sent[0].payload.body).toContain('Nov 27');
    expect(sent[0].payload.body).not.toContain('Riverside');
    expect(sent[0].payload.url).toBe(`/family/${circleId}/runs/`);
  });

  it('claim notifies the event creator; release re-notifies the others; a covered create stays silent', async () => {
    const { a, b, circleId, kidId } = await family();
    await saveSubscription(db, a.id, sub('trig2-a'), null);
    await saveSubscription(db, b.id, sub('trig2-b'), null);
    const { sent, sender } = capture();
    setPushSenderForTests(sender);

    const coveredId = mustId(await createEvent(db, circleId, a.id, runInput({ kidIds: [kidId], driverUserId: b.id })));
    expect(sent).toHaveLength(0);

    const runId = mustId(await createEvent(db, circleId, a.id, runInput({ kidIds: [kidId] })));
    expect(sent).toHaveLength(1); // uncovered on create → B
    sent.length = 0;

    expect(await claimRun(db, circleId, b.id, runId)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe(a.id);
    expect(sent[0].payload.title).toBe('Run covered');
    expect(sent[0].payload.body).toContain('Maya');
    expect(sent[0].payload.body).toContain('has a driver');
    sent.length = 0;

    expect(await releaseRun(db, circleId, b.id, runId)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe(a.id);
    expect(sent[0].payload.title).toBe('A run needs a driver');

    // Editing the covered run to lose its driver notifies once; editing it again while
    // it stays uncovered does not re-notify.
    sent.length = 0;
    expect(await updateEvent(db, circleId, a.id, coveredId, runInput({ kidIds: [kidId], driverUserId: null }))).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe(b.id);
    sent.length = 0;
    expect(await updateEvent(db, circleId, a.id, coveredId, runInput({ kidIds: [kidId], driverUserId: null, title: 'School pickup (updated)' }))).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('the test push reaches only the caller', async () => {
    const { a, b } = await family();
    await saveSubscription(db, a.id, sub('trig3-a'), null);
    await saveSubscription(db, b.id, sub('trig3-b'), null);
    const { sent, sender } = capture();
    setPushSenderForTests(sender);
    expect(await sendTestPush(db, a.id)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe(a.id);
    expect(sent[0].payload.title).toBe('SparkKindly');
  });
});

describe('push web handlers', () => {
  const HEAD = {
    host: 'staging.sparkkindly.com',
    origin: 'https://staging.sparkkindly.com',
    'content-type': 'application/x-www-form-urlencoded',
  };
  const post = (body: Record<string, string>, opts: { cookie?: string; origin?: string | null } = {}) => {
    const headers: Record<string, string> = { ...HEAD };
    if (opts.origin === null) delete headers.origin;
    else if (opts.origin) headers.origin = opts.origin;
    if (opts.cookie) headers.cookie = `__Host-sk_account=${opts.cookie}`;
    return new Request('http://localhost/x', { method: 'POST', headers, body: new URLSearchParams(body).toString() });
  };

  beforeEach(() => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'test-public-key');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'test-private-key');
    vi.stubEnv('VAPID_SUBJECT', 'mailto:test@example.test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  });

  it('subscribe stores against the session account; no Origin is 403', async () => {
    const a = await adult();
    const bad = await pushSubscribeRequest(post(sub('web-a'), { cookie: a.session, origin: null }), { db, now: T0 });
    expect(bad.status).toBe(403);
    expect(await countSubscriptions(db, a.id)).toBe(0);
    const ok = await pushSubscribeRequest(post(sub('web-a'), { cookie: a.session }), { db, now: T0 });
    expect(ok.status).toBe(303);
    expect(await countSubscriptions(db, a.id)).toBe(1);
  });

  it("unsubscribe via the web cannot remove another account's subscription", async () => {
    const a = await adult();
    const b = await adult();
    await saveSubscription(db, b.id, sub('web-b'), null);
    const res = await pushUnsubscribeRequest(post({ endpoint: 'https://push.example/web-b' }, { cookie: a.session }), { db, now: T0 });
    expect(res.status).toBe(303);
    expect(await countSubscriptions(db, b.id)).toBe(1);
  });
});
