// Family Hub Web Push (Phase 2.5, 27 Nov 2026): subscriptions and run notifications.
//
// Subscriptions: one row per browser push endpoint (migration 052). A user manages ONLY
// their own rows — every write is filtered by the caller's account id, so an unsubscribe
// naming someone else's endpoint deletes nothing. Re-subscribing an endpoint moves it
// to the subscribing account (an endpoint belongs to one browser; whoever subscribes
// from that browser owns it now).
//
// Notifications are a side dish, never the meal: every notify function swallows its own
// errors and, when no VAPID keys are configured, returns before touching the database —
// a push problem can never break the run claim/release that triggered it. Payloads
// carry kid first names and times only: never an address, a location or an adult's
// email (accounts have no display names, so the claimed message names the kid, not the
// driver). Dead endpoints (push service 404/410) are pruned on send.
// No Next.js imports. Verified by tests/unit/family-hub-push.test.ts.
import { sendNotification, setVapidDetails } from 'web-push';
import type { Db, Queryable } from '@/lib/db';
import { pushConfig } from './push-config';

export type PushPayload = { title: string; body: string; url: string };
export type StoredSubscription = { id: string; userId: string; endpoint: string; p256dh: string; auth: string };

export type PushSender = (sub: StoredSubscription, payload: PushPayload) => Promise<void>;

// Tests substitute a capturing sender; production uses web-push. The seam exists so the
// trigger tests never touch a real push service.
let testSender: PushSender | null = null;
export function setPushSenderForTests(sender: PushSender | null): void {
  testSender = sender;
}

const defaultSender: PushSender = async (sub, payload) => {
  const cfg = pushConfig();
  if (!cfg) return;
  setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  await sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload),
    { TTL: 3600 },
  );
};

const pushReady = (): boolean => testSender !== null || pushConfig() !== null;

// ---- Subscriptions ----

type SubRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
const subOf = (x: SubRow): StoredSubscription => ({ id: x.id, userId: x.user_id, endpoint: x.endpoint, p256dh: x.p256dh, auth: x.auth });

const cleanKey = (v: unknown): string | null => (typeof v === 'string' && v.length >= 1 && v.length <= 500 ? v : null);

export async function saveSubscription(
  db: Db,
  userId: string,
  input: { endpoint: unknown; p256dh: unknown; auth: unknown },
  userAgent: string | null,
): Promise<boolean> {
  const endpoint = typeof input.endpoint === 'string' ? input.endpoint : '';
  if (!endpoint.startsWith('https://') || endpoint.length > 1000) return false;
  const p256dh = cleanKey(input.p256dh);
  const auth = cleanKey(input.auth);
  if (!p256dh || !auth) return false;
  await db.query(
    `INSERT INTO hub_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, last_seen_at = now()`,
    [userId, endpoint, p256dh, auth, userAgent ? userAgent.slice(0, 300) : null],
  );
  return true;
}

export async function removeSubscription(db: Db, userId: string, endpoint: unknown): Promise<boolean> {
  if (typeof endpoint !== 'string' || endpoint === '') return false;
  const r = await db.query('DELETE FROM hub_push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
  return r.rowCount === 1;
}

export async function countSubscriptions(db: Queryable, userId: string): Promise<number> {
  const r = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM hub_push_subscriptions WHERE user_id = $1', [userId]);
  return r.rows[0]?.n ?? 0;
}

async function listSubscriptions(db: Queryable, userIds: string[]): Promise<StoredSubscription[]> {
  if (userIds.length === 0) return [];
  const r = await db.query<SubRow>('SELECT id, user_id, endpoint, p256dh, auth FROM hub_push_subscriptions WHERE user_id = ANY($1::uuid[])', [userIds]);
  return r.rows.map(subOf);
}

// Sends one payload to every subscription of the given users. Returns how many were
// accepted by the push service. Never throws; a gone endpoint (404/410) is pruned.
export async function sendPushToUsers(db: Db, userIds: string[], payload: PushPayload): Promise<number> {
  if (!pushReady() || userIds.length === 0) return 0;
  const sender = testSender ?? defaultSender;
  let sent = 0;
  try {
    const subs = await listSubscriptions(db, [...new Set(userIds)]);
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await sender(sub, payload);
          sent += 1;
          await db.query('UPDATE hub_push_subscriptions SET last_seen_at = now() WHERE id = $1', [sub.id]).catch(() => undefined);
        } catch (e) {
          const code = (e as { statusCode?: unknown })?.statusCode;
          if (code === 404 || code === 410) {
            await db.query('DELETE FROM hub_push_subscriptions WHERE id = $1', [sub.id]).catch(() => undefined);
          }
        }
      }),
    );
  } catch {
    return sent;
  }
  return sent;
}

export async function sendTestPush(db: Db, userId: string): Promise<number> {
  return sendPushToUsers(db, [userId], {
    title: 'SparkKindly',
    body: 'Test notification — Family Hub alerts are switched on for this device.',
    url: '/family/',
  });
}

// ---- Run notifications ----

type RunFacts = { title: string; startsAt: Date; createdBy: string; timeZone: string; kidNames: string[] };

async function runFacts(db: Queryable, circleId: string, eventId: string): Promise<RunFacts | null> {
  const r = await db.query<{ title: string; starts_at: string; created_by: string; time_zone: string }>(
    `SELECT e.title, e.starts_at, e.created_by, c.time_zone FROM hub_events e
     JOIN hub_circles c ON c.id = e.circle_id
     WHERE e.circle_id = $1 AND e.id = $2 AND e.is_run`,
    [circleId, eventId],
  );
  const x = r.rows[0];
  if (!x) return null;
  const kids = await db.query<{ first_name: string }>(
    `SELECT k.first_name FROM hub_event_participants p JOIN hub_kid_profiles k ON k.id = p.kid_profile_id
     WHERE p.event_id = $1 ORDER BY k.created_at`,
    [eventId],
  );
  return { title: x.title, startsAt: new Date(x.starts_at), createdBy: x.created_by, timeZone: x.time_zone, kidNames: kids.rows.map((k) => k.first_name) };
}

const whenText = (facts: RunFacts): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: facts.timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(facts.startsAt);

const subjectText = (facts: RunFacts): string => (facts.kidNames.length > 0 ? facts.kidNames.join(', ') : facts.title);

// A run became uncovered (created without a driver, released, or edited to lose its
// driver): tell the circle's OTHER adults. The actor already knows.
export async function notifyRunUncovered(db: Db, circleId: string, eventId: string, actorId: string): Promise<void> {
  try {
    if (!pushReady()) return;
    const facts = await runFacts(db, circleId, eventId);
    if (!facts) return;
    const members = await db.query<{ user_id: string }>('SELECT user_id FROM hub_circle_members WHERE circle_id = $1 AND user_id <> $2', [circleId, actorId]);
    await sendPushToUsers(db, members.rows.map((m) => m.user_id), {
      title: 'A run needs a driver',
      body: `${subjectText(facts)} — ${whenText(facts)}`,
      url: `/family/${circleId}/runs/`,
    });
  } catch {
    // Push is best-effort; the run write that triggered this has already succeeded.
  }
}

// A run was claimed: tell the adult who created the event (if it wasn't them, and they
// are still in the circle).
export async function notifyRunClaimed(db: Db, circleId: string, eventId: string, actorId: string): Promise<void> {
  try {
    if (!pushReady()) return;
    const facts = await runFacts(db, circleId, eventId);
    if (!facts || facts.createdBy === actorId) return;
    const still = await db.query('SELECT 1 FROM hub_circle_members WHERE circle_id = $1 AND user_id = $2', [circleId, facts.createdBy]);
    if (still.rows.length !== 1) return;
    await sendPushToUsers(db, [facts.createdBy], {
      title: 'Run covered',
      body: `${subjectText(facts)} has a driver — ${whenText(facts)}`,
      url: `/family/${circleId}/runs/`,
    });
  } catch {
    // Best-effort, as above.
  }
}
