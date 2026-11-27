// Family Hub data layer (Phase 1). Every read and write is scoped to circles the signed-in
// account belongs to: membership is checked inside each function, never trusted from a caller,
// and a non-member gets the same answer as "does not exist" (null / empty / false).
// No Next.js imports. Verified by tests/unit/family-hub.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { isUuid } from '@/lib/accounts/pin';
import { hash, newToken } from '@/lib/tokens';
import { LIMITS, cleanName, expandOccurrences, isAvatarId, isColour, isHubAgeGroup, parsePhone, type HubAgeGroup } from './rules';

export type Role = 'organizer' | 'member';

export type Circle = { id: string; name: string; timeZone: string; role: Role; createdBy: string };
export type Member = { userId: string; email: string; role: Role };
export type Kid = { id: string; firstName: string; ageGroup: HubAgeGroup; avatarId: string; colour: string; phone: string | null };
export type HubEvent = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  recurrence: 'weekly' | null;
  recurrenceUntil: Date | null;
  location: string | null;
  notes: string | null;
  isRun: boolean;
  driverUserId: string | null;
  runStatus: 'covered' | 'uncovered' | 'done' | null;
  memberIds: string[];
  kidIds: string[];
};
export type Activity = { kind: string; message: string; createdAt: Date };

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function memberRole(db: Queryable, circleId: string, userId: string): Promise<Role | null> {
  if (!isUuid(circleId)) return null;
  const r = await db.query<{ role: Role }>('SELECT role FROM hub_circle_members WHERE circle_id = $1 AND user_id = $2', [circleId, userId]);
  return r.rows[0]?.role ?? null;
}

export async function myCircles(db: Queryable, userId: string): Promise<Circle[]> {
  const r = await db.query<{ id: string; name: string; time_zone: string; role: Role; created_by: string }>(
    `SELECT c.id, c.name, c.time_zone, m.role, c.created_by FROM hub_circles c
     JOIN hub_circle_members m ON m.circle_id = c.id WHERE m.user_id = $1 ORDER BY c.created_at`,
    [userId],
  );
  return r.rows.map((x) => ({ id: x.id, name: x.name, timeZone: x.time_zone, role: x.role, createdBy: x.created_by }));
}

export async function getCircle(db: Queryable, circleId: string, userId: string): Promise<Circle | null> {
  if (!isUuid(circleId)) return null;
  const r = await db.query<{ id: string; name: string; time_zone: string; role: Role; created_by: string }>(
    `SELECT c.id, c.name, c.time_zone, m.role, c.created_by FROM hub_circles c
     JOIN hub_circle_members m ON m.circle_id = c.id WHERE c.id = $1 AND m.user_id = $2`,
    [circleId, userId],
  );
  const x = r.rows[0];
  return x ? { id: x.id, name: x.name, timeZone: x.time_zone, role: x.role, createdBy: x.created_by } : null;
}

export async function createCircle(db: Db, userId: string, name: unknown, timeZone: unknown): Promise<{ id: string } | 'invalid' | 'limit'> {
  const n = cleanName(name, 60);
  if (!n) return 'invalid';
  const tz = typeof timeZone === 'string' && /^[A-Za-z_]+\/[A-Za-z_+-]+$/.test(timeZone) ? timeZone : 'UTC';
  return db.transaction(async (tx) => {
    const count = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM hub_circle_members WHERE user_id = $1', [userId]);
    if ((count.rows[0]?.n ?? 0) >= LIMITS.circlesPerUser) return 'limit' as const;
    const c = await tx.query<{ id: string }>('INSERT INTO hub_circles (name, time_zone, created_by) VALUES ($1, $2, $3) RETURNING id', [n, tz, userId]);
    const id = c.rows[0].id;
    await tx.query("INSERT INTO hub_circle_members (circle_id, user_id, role) VALUES ($1, $2, 'organizer')", [id, userId]);
    await logActivity(tx, id, userId, 'circle', `Circle “${n}” created.`);
    return { id };
  });
}

export async function listMembers(db: Queryable, circleId: string, userId: string): Promise<Member[] | null> {
  if (!(await memberRole(db, circleId, userId))) return null;
  const r = await db.query<{ user_id: string; email: string; role: Role }>(
    `SELECT m.user_id, a.email, m.role FROM hub_circle_members m JOIN accounts a ON a.id = m.user_id
     WHERE m.circle_id = $1 ORDER BY m.created_at`,
    [circleId],
  );
  return r.rows.map((x) => ({ userId: x.user_id, email: x.email, role: x.role }));
}

// Organizer-only member management. The last organizer can never be removed or demoted.
export async function setMemberRole(db: Db, circleId: string, actorId: string, targetId: string, role: Role): Promise<boolean> {
  return db.transaction(async (tx) => {
    if ((await memberRole(tx, circleId, actorId)) !== 'organizer') return false;
    if (role === 'member') {
      const orgs = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM hub_circle_members WHERE circle_id = $1 AND role = 'organizer'", [circleId]);
      const target = await memberRole(tx, circleId, targetId);
      if (target === 'organizer' && (orgs.rows[0]?.n ?? 0) <= 1) return false;
    }
    const r = await tx.query('UPDATE hub_circle_members SET role = $3 WHERE circle_id = $1 AND user_id = $2', [circleId, targetId, role]);
    return r.rowCount === 1;
  });
}

export async function removeMember(db: Db, circleId: string, actorId: string, targetId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    if ((await memberRole(tx, circleId, actorId)) !== 'organizer') return false;
    const target = await memberRole(tx, circleId, targetId);
    if (!target) return false;
    if (target === 'organizer') {
      const orgs = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM hub_circle_members WHERE circle_id = $1 AND role = 'organizer'", [circleId]);
      if ((orgs.rows[0]?.n ?? 0) <= 1) return false;
    }
    await tx.query('UPDATE hub_events SET driver_user_id = NULL, run_status = CASE WHEN is_run THEN \'uncovered\' ELSE run_status END, updated_at = now() WHERE circle_id = $1 AND driver_user_id = $2 AND run_status = \'covered\'', [circleId, targetId]);
    const r = await tx.query('DELETE FROM hub_circle_members WHERE circle_id = $1 AND user_id = $2', [circleId, targetId]);
    return r.rowCount === 1;
  });
}

export async function createInvite(db: Db, circleId: string, actorId: string, invitedEmail: unknown, now: Date): Promise<{ token: string } | null> {
  if (!(await memberRole(db, circleId, actorId))) return null;
  const email = typeof invitedEmail === 'string' && invitedEmail.trim() !== '' ? invitedEmail.trim().toLowerCase() : null;
  if (email !== null && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return null;
  const token = newToken();
  await db.query('INSERT INTO hub_circle_invites (circle_id, token_hash, invited_email, created_by, expires_at) VALUES ($1, $2, $3, $4, $5)', [
    circleId,
    hash(token),
    email,
    actorId,
    new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
  ]);
  return { token };
}

export type AcceptResult = 'joined' | 'already' | 'gone' | 'full';

// Accepting is idempotent for an existing member; a used or expired token is 'gone'.
// An email-bound invite can only be accepted by that account.
export async function acceptInvite(db: Db, token: string, userId: string, userEmail: string, now: Date): Promise<{ result: AcceptResult; circleId?: string }> {
  if (typeof token !== 'string' || token.length < 16) return { result: 'gone' };
  return db.transaction(async (tx) => {
    const r = await tx.query<{ id: string; circle_id: string; invited_email: string | null; expires_at: string; accepted_at: string | null }>(
      'SELECT id, circle_id, invited_email, expires_at, accepted_at FROM hub_circle_invites WHERE token_hash = $1 FOR UPDATE',
      [hash(token)],
    );
    const inv = r.rows[0];
    if (!inv || inv.accepted_at || new Date(inv.expires_at) <= now) return { result: 'gone' as const };
    if (inv.invited_email && inv.invited_email !== userEmail.toLowerCase()) return { result: 'gone' as const };
    if (await memberRole(tx, inv.circle_id, userId)) {
      await tx.query('UPDATE hub_circle_invites SET accepted_by = $2, accepted_at = $3 WHERE id = $1', [inv.id, userId, now.toISOString()]);
      return { result: 'already' as const, circleId: inv.circle_id };
    }
    const count = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM hub_circle_members WHERE circle_id = $1', [inv.circle_id]);
    if ((count.rows[0]?.n ?? 0) >= LIMITS.membersPerCircle) return { result: 'full' as const };
    await tx.query("INSERT INTO hub_circle_members (circle_id, user_id, role) VALUES ($1, $2, 'member')", [inv.circle_id, userId]);
    await tx.query('UPDATE hub_circle_invites SET accepted_by = $2, accepted_at = $3 WHERE id = $1', [inv.id, userId, now.toISOString()]);
    await logActivity(tx, inv.circle_id, userId, 'member', 'A new member joined the circle.');
    return { result: 'joined' as const, circleId: inv.circle_id };
  });
}

export async function inviteCircleName(db: Queryable, token: string, now: Date): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 16) return null;
  const r = await db.query<{ name: string }>(
    `SELECT c.name FROM hub_circle_invites i JOIN hub_circles c ON c.id = i.circle_id
     WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > $2`,
    [hash(token), now.toISOString()],
  );
  return r.rows[0]?.name ?? null;
}

// ---- Kid profiles ----

export type KidInput = { firstName: unknown; ageGroup: unknown; avatarId: unknown; colour: unknown; phone: unknown };

function parseKid(input: KidInput): { firstName: string; ageGroup: HubAgeGroup; avatarId: string; colour: string; phone: string | null } | null {
  const firstName = cleanName(input.firstName, 30);
  if (!firstName || !isHubAgeGroup(input.ageGroup)) return null;
  const phone = parsePhone(input.phone);
  if (!phone.ok) return null;
  return {
    firstName,
    ageGroup: input.ageGroup,
    avatarId: isAvatarId(input.avatarId) ? input.avatarId : 'spark',
    colour: isColour(input.colour) ? input.colour : 'purple',
    phone: phone.phone,
  };
}

export async function listKids(db: Queryable, circleId: string, userId: string): Promise<Kid[] | null> {
  if (!(await memberRole(db, circleId, userId))) return null;
  const r = await db.query<{ id: string; first_name: string; age_group: HubAgeGroup; avatar_id: string; colour: string; phone: string | null }>(
    'SELECT id, first_name, age_group, avatar_id, colour, phone FROM hub_kid_profiles WHERE circle_id = $1 ORDER BY created_at',
    [circleId],
  );
  return r.rows.map((x) => ({ id: x.id, firstName: x.first_name, ageGroup: x.age_group, avatarId: x.avatar_id, colour: x.colour, phone: x.phone }));
}

export async function createKid(db: Db, circleId: string, actorId: string, input: KidInput): Promise<Kid | 'invalid' | 'limit' | null> {
  if (!(await memberRole(db, circleId, actorId))) return null;
  const k = parseKid(input);
  if (!k) return 'invalid';
  const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM hub_kid_profiles WHERE circle_id = $1', [circleId]);
  if ((count.rows[0]?.n ?? 0) >= LIMITS.kidsPerCircle) return 'limit';
  const r = await db.query<{ id: string }>(
    'INSERT INTO hub_kid_profiles (circle_id, first_name, age_group, avatar_id, colour, phone) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [circleId, k.firstName, k.ageGroup, k.avatarId, k.colour, k.phone],
  );
  await logActivity(db, circleId, actorId, 'kid', `${k.firstName} was added to the circle.`);
  return { id: r.rows[0].id, ...k };
}

export async function updateKid(db: Db, circleId: string, actorId: string, kidId: string, input: KidInput): Promise<boolean> {
  if (!isUuid(kidId) || !(await memberRole(db, circleId, actorId))) return false;
  const k = parseKid(input);
  if (!k) return false;
  const r = await db.query(
    'UPDATE hub_kid_profiles SET first_name = $3, age_group = $4, avatar_id = $5, colour = $6, phone = $7, updated_at = now() WHERE circle_id = $1 AND id = $2',
    [circleId, kidId, k.firstName, k.ageGroup, k.avatarId, k.colour, k.phone],
  );
  return r.rowCount === 1;
}

export async function deleteKid(db: Db, circleId: string, actorId: string, kidId: string): Promise<boolean> {
  if (!isUuid(kidId) || !(await memberRole(db, circleId, actorId))) return false;
  const r = await db.query('DELETE FROM hub_kid_profiles WHERE circle_id = $1 AND id = $2', [circleId, kidId]);
  return r.rowCount === 1;
}

// ---- Events & runs ----

export type EventInput = {
  title: unknown;
  startsAt: unknown;
  endsAt: unknown;
  recurrence: unknown;
  recurrenceUntil: unknown;
  location: unknown;
  notes: unknown;
  isRun: unknown;
  driverUserId: unknown;
  memberIds: unknown;
  kidIds: unknown;
};

type ParsedEvent = {
  title: string;
  startsAt: Date;
  endsAt: Date;
  recurrence: 'weekly' | null;
  recurrenceUntil: Date | null;
  location: string | null;
  notes: string | null;
  isRun: boolean;
  driverUserId: string | null;
  memberIds: string[];
  kidIds: string[];
};

const asDate = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && v.trim() !== '') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const idList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && isUuid(x)) : []);

function parseEvent(input: EventInput): ParsedEvent | null {
  const title = cleanName(input.title, 120);
  const startsAt = asDate(input.startsAt);
  const endsAt = asDate(input.endsAt);
  if (!title || !startsAt || !endsAt || endsAt <= startsAt) return null;
  const recurrence = input.recurrence === 'weekly' ? ('weekly' as const) : null;
  const recurrenceUntil = recurrence ? asDate(input.recurrenceUntil) : null;
  const location = input.location === null || input.location === undefined || input.location === '' ? null : cleanName(input.location, 200);
  if (input.location && location === null) return null;
  const notes = typeof input.notes === 'string' && input.notes.trim() !== '' ? input.notes.trim().slice(0, 500) : null;
  const isRun = input.isRun === true;
  const driverUserId = isRun && typeof input.driverUserId === 'string' && isUuid(input.driverUserId) ? input.driverUserId : null;
  return { title, startsAt, endsAt, recurrence, recurrenceUntil, location, notes, isRun, driverUserId, memberIds: idList(input.memberIds), kidIds: idList(input.kidIds) };
}

// Participants and the driver must belong to the circle; anything else is dropped, and a
// driver outside the circle makes the whole write invalid rather than silently uncovered.
async function validatePeople(tx: Queryable, circleId: string, p: ParsedEvent): Promise<boolean> {
  if (p.driverUserId && !(await memberRole(tx, circleId, p.driverUserId))) return false;
  for (const m of p.memberIds) if (!(await memberRole(tx, circleId, m))) return false;
  for (const k of p.kidIds) {
    const r = await tx.query('SELECT 1 FROM hub_kid_profiles WHERE circle_id = $1 AND id = $2', [circleId, k]);
    if (r.rows.length !== 1) return false;
  }
  return true;
}

async function writeParticipants(tx: Queryable, eventId: string, p: ParsedEvent): Promise<void> {
  await tx.query('DELETE FROM hub_event_participants WHERE event_id = $1', [eventId]);
  for (const m of p.memberIds) await tx.query('INSERT INTO hub_event_participants (event_id, member_user_id) VALUES ($1, $2)', [eventId, m]);
  for (const k of p.kidIds) await tx.query('INSERT INTO hub_event_participants (event_id, kid_profile_id) VALUES ($1, $2)', [eventId, k]);
}

export async function createEvent(db: Db, circleId: string, actorId: string, input: EventInput): Promise<{ id: string } | 'invalid' | 'limit' | null> {
  if (!(await memberRole(db, circleId, actorId))) return null;
  const p = parseEvent(input);
  if (!p) return 'invalid';
  return db.transaction(async (tx) => {
    if (!(await validatePeople(tx, circleId, p))) return 'invalid' as const;
    const count = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM hub_events WHERE circle_id = $1', [circleId]);
    if ((count.rows[0]?.n ?? 0) >= LIMITS.eventsPerCircle) return 'limit' as const;
    const r = await tx.query<{ id: string }>(
      `INSERT INTO hub_events (circle_id, title, starts_at, ends_at, recurrence, recurrence_until, location, notes, is_run, driver_user_id, run_status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        circleId, p.title, p.startsAt.toISOString(), p.endsAt.toISOString(), p.recurrence,
        p.recurrenceUntil ? p.recurrenceUntil.toISOString().slice(0, 10) : null, p.location, p.notes,
        p.isRun, p.isRun ? p.driverUserId : null, p.isRun ? (p.driverUserId ? 'covered' : 'uncovered') : null, actorId,
      ],
    );
    await writeParticipants(tx, r.rows[0].id, p);
    return { id: r.rows[0].id };
  });
}

export async function updateEvent(db: Db, circleId: string, actorId: string, eventId: string, input: EventInput): Promise<boolean> {
  if (!isUuid(eventId) || !(await memberRole(db, circleId, actorId))) return false;
  const p = parseEvent(input);
  if (!p) return false;
  return db.transaction(async (tx) => {
    if (!(await validatePeople(tx, circleId, p))) return false;
    const r = await tx.query(
      `UPDATE hub_events SET title = $3, starts_at = $4, ends_at = $5, recurrence = $6, recurrence_until = $7,
         location = $8, notes = $9, is_run = $10, driver_user_id = $11,
         run_status = CASE WHEN $10 THEN (CASE WHEN $11 IS NOT NULL THEN 'covered' ELSE 'uncovered' END) ELSE NULL END,
         updated_at = now()
       WHERE circle_id = $1 AND id = $2`,
      [
        circleId, eventId, p.title, p.startsAt.toISOString(), p.endsAt.toISOString(), p.recurrence,
        p.recurrenceUntil ? p.recurrenceUntil.toISOString().slice(0, 10) : null, p.location, p.notes,
        p.isRun, p.isRun ? p.driverUserId : null,
      ],
    );
    if (r.rowCount !== 1) return false;
    await writeParticipants(tx, eventId, p);
    return true;
  });
}

export async function deleteEvent(db: Db, circleId: string, actorId: string, eventId: string): Promise<boolean> {
  if (!isUuid(eventId) || !(await memberRole(db, circleId, actorId))) return false;
  const r = await db.query('DELETE FROM hub_events WHERE circle_id = $1 AND id = $2', [circleId, eventId]);
  return r.rowCount === 1;
}

type EventRow = {
  id: string; title: string; starts_at: string; ends_at: string; recurrence: 'weekly' | null;
  recurrence_until: string | null; location: string | null; notes: string | null; is_run: boolean;
  driver_user_id: string | null; run_status: 'covered' | 'uncovered' | 'done' | null;
};

async function loadEvents(db: Queryable, circleId: string, from: Date, to: Date): Promise<HubEvent[]> {
  // Candidate series: started before the window ends and not (non-recurring and already over).
  const r = await db.query<EventRow>(
    `SELECT id, title, starts_at, ends_at, recurrence, recurrence_until, location, notes, is_run, driver_user_id, run_status
     FROM hub_events WHERE circle_id = $1 AND starts_at < $3 AND (recurrence IS NOT NULL OR ends_at > $2)
     ORDER BY starts_at`,
    [circleId, from.toISOString(), to.toISOString()],
  );
  const events: HubEvent[] = [];
  for (const x of r.rows) {
    const parts = await db.query<{ member_user_id: string | null; kid_profile_id: string | null }>(
      'SELECT member_user_id, kid_profile_id FROM hub_event_participants WHERE event_id = $1',
      [x.id],
    );
    events.push({
      id: x.id,
      title: x.title,
      startsAt: new Date(x.starts_at),
      endsAt: new Date(x.ends_at),
      recurrence: x.recurrence,
      recurrenceUntil: x.recurrence_until ? new Date(x.recurrence_until) : null,
      location: x.location,
      notes: x.notes,
      isRun: x.is_run,
      driverUserId: x.driver_user_id,
      runStatus: x.run_status,
      memberIds: parts.rows.map((p) => p.member_user_id).filter((v): v is string => v !== null),
      kidIds: parts.rows.map((p) => p.kid_profile_id).filter((v): v is string => v !== null),
    });
  }
  return events;
}

export type Occurrence = { event: HubEvent; startsAt: Date; endsAt: Date };

// Events (with weekly series expanded) whose occurrence starts inside [from, to).
export async function listOccurrences(db: Queryable, circleId: string, userId: string, from: Date, to: Date): Promise<Occurrence[] | null> {
  if (!(await memberRole(db, circleId, userId))) return null;
  const events = await loadEvents(db, circleId, from, to);
  const out: Occurrence[] = [];
  for (const e of events) {
    const dur = e.endsAt.getTime() - e.startsAt.getTime();
    for (const s of expandOccurrences(e, from, to)) out.push({ event: e, startsAt: s, endsAt: new Date(s.getTime() + dur) });
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export async function listRuns(db: Queryable, circleId: string, userId: string, from: Date, to: Date): Promise<Occurrence[] | null> {
  const occ = await listOccurrences(db, circleId, userId, from, to);
  return occ ? occ.filter((o) => o.event.isRun) : null;
}

export async function getEvent(db: Queryable, circleId: string, userId: string, eventId: string): Promise<HubEvent | null> {
  if (!isUuid(eventId) || !(await memberRole(db, circleId, userId))) return null;
  const from = new Date(0);
  const to = new Date('9999-01-01T00:00:00Z');
  const events = await loadEvents(db, circleId, from, to);
  return events.find((e) => e.id === eventId) ?? null;
}

// Run transitions. Claim: any member takes the wheel (from uncovered, or a swap away from
// another driver). Release: the driver or an organizer sends it back to uncovered.
// Done: the driver or an organizer. All return false for non-members / non-runs.
export async function claimRun(db: Db, circleId: string, actorId: string, eventId: string): Promise<boolean> {
  if (!isUuid(eventId) || !(await memberRole(db, circleId, actorId))) return false;
  const r = await db.query(
    "UPDATE hub_events SET driver_user_id = $3, run_status = 'covered', updated_at = now() WHERE circle_id = $1 AND id = $2 AND is_run",
    [circleId, eventId, actorId],
  );
  if (r.rowCount !== 1) return false;
  await logActivity(db, circleId, actorId, 'run', 'A run was claimed.');
  return true;
}

export async function releaseRun(db: Db, circleId: string, actorId: string, eventId: string): Promise<boolean> {
  if (!isUuid(eventId)) return false;
  const role = await memberRole(db, circleId, actorId);
  if (!role) return false;
  const where = role === 'organizer' ? '' : ' AND driver_user_id = $3';
  const params = role === 'organizer' ? [circleId, eventId] : [circleId, eventId, actorId];
  const r = await db.query(
    `UPDATE hub_events SET driver_user_id = NULL, run_status = 'uncovered', updated_at = now()
     WHERE circle_id = $1 AND id = $2 AND is_run AND run_status = 'covered'${where}`,
    params,
  );
  if (r.rowCount !== 1) return false;
  await logActivity(db, circleId, actorId, 'run', 'A run was released and needs a driver.');
  return true;
}

export async function doneRun(db: Db, circleId: string, actorId: string, eventId: string): Promise<boolean> {
  if (!isUuid(eventId)) return false;
  const role = await memberRole(db, circleId, actorId);
  if (!role) return false;
  const where = role === 'organizer' ? '' : ' AND driver_user_id = $3';
  const params = role === 'organizer' ? [circleId, eventId] : [circleId, eventId, actorId];
  const r = await db.query(
    `UPDATE hub_events SET run_status = 'done', updated_at = now()
     WHERE circle_id = $1 AND id = $2 AND is_run AND run_status = 'covered'${where}`,
    params,
  );
  if (r.rowCount !== 1) return false;
  await logActivity(db, circleId, actorId, 'run', 'A run was marked done.');
  return true;
}

export async function logActivity(db: Queryable, circleId: string, actorId: string | null, kind: string, message: string, eventId?: string): Promise<void> {
  await db.query('INSERT INTO hub_activity (circle_id, actor_user_id, kind, message, event_id) VALUES ($1, $2, $3, $4, $5)', [
    circleId, actorId, kind, message.slice(0, 300), eventId ?? null,
  ]);
}

export async function listActivity(db: Queryable, circleId: string, userId: string, limit = 10): Promise<Activity[] | null> {
  if (!(await memberRole(db, circleId, userId))) return null;
  const r = await db.query<{ kind: string; message: string; created_at: string }>(
    'SELECT kind, message, created_at FROM hub_activity WHERE circle_id = $1 ORDER BY created_at DESC LIMIT $2',
    [circleId, Math.min(Math.max(limit, 1), 50)],
  );
  return r.rows.map((x) => ({ kind: x.kind, message: x.message, createdAt: new Date(x.created_at) }));
}
