// Joining a circle (plan 4B, spec Project 4 "Circle rules" and 4a.5): the one set of join rules, shared by invite
// acceptance and community joining. Age group and consent are re-derived from the stored account row; the circle row is
// locked first (FOR UPDATE), then the account row, so concurrent joins cannot pass the member limits together. A
// child-profile context never reaches here (the web layer refuses it). No Next.js imports.
// Verified by tests/unit/circles-join.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { isUuid } from '@/lib/accounts/pin';
import { ageGroupFor, can, type AgeGroup, type Consent } from '@/lib/accounts/policy';
import { circleHasChild } from './children';
import { LIMITS, cleanMemberName, type CircleKind } from './rules';
import { memberCount } from './repo';

export type JoinReason =
  | 'capability'
  | 'community_age'
  | 'has_child_adults_only'
  | 'invite_only'
  | 'full'
  | 'account_limit'
  | 'already_member'
  | 'closed';
export type JoinResult = { status: 'joined'; slug: string } | { status: JoinReason | 'name' };

export type JoinInput = {
  group: AgeGroup;
  consent: Consent;
  circleKind: CircleKind;
  circleHasChild: boolean;
  viaInvite: boolean;
  memberCount: number;
  accountCircleCount: number;
  alreadyMember: boolean;
  circleOpen: boolean;
  circleHidden: boolean;
};

function refusal(i: JoinInput): JoinReason | null {
  if (!i.circleOpen || i.circleHidden) return 'closed';
  if (i.alreadyMember) return 'already_member';
  if (!can(i.group, i.consent, 'join_circle')) return 'capability';
  if (i.circleKind === 'community' && !can(i.group, i.consent, 'join_community')) return 'community_age';
  if (i.circleKind !== 'community' && !i.viaInvite) return 'invite_only';
  if (i.circleHasChild && i.group !== 'adult') return 'has_child_adults_only';
  if (i.memberCount >= LIMITS.members) return 'full';
  if (i.accountCircleCount >= LIMITS.memberOf) return 'account_limit';
  return null;
}

export function canJoin(i: JoinInput): { ok: true } | { ok: false; reason: JoinReason } {
  const reason = refusal(i);
  return reason ? { ok: false, reason } : { ok: true };
}

export type LockedCircle = { id: string; slug: string; kind: CircleKind; status: 'open' | 'closed'; hidden_at: Date | null };

// Locks a circle row by id for a join (the first lock a join takes), or null.
export async function lockCircleById(tx: Queryable, circleId: string): Promise<LockedCircle | null> {
  if (!isUuid(circleId)) return null;
  const r = await tx.query<LockedCircle>('SELECT id, slug, kind, status, hidden_at FROM circles WHERE id = $1 FOR UPDATE', [
    circleId,
  ]);
  return r.rows[0] ?? null;
}

type Joiner = { dob: string; consent_state: Consent; circles: number; member: boolean };

// The account row, locked, with its open-circle count and whether it is already a current member of this circle.
async function lockJoiner(tx: Queryable, accountId: string, circleId: string): Promise<Joiner | null> {
  const r = await tx.query<Joiner>(
    `SELECT to_char(a.date_of_birth, 'YYYY-MM-DD') AS dob, a.consent_state,
       (SELECT count(*)::int FROM circle_members m JOIN circles c ON c.id = m.circle_id
        WHERE m.account_id = a.id AND m.profile_id IS NULL AND m.left_at IS NULL AND c.status = 'open') AS circles,
       EXISTS (SELECT 1 FROM circle_members m WHERE m.circle_id = $2 AND m.account_id = a.id AND m.profile_id IS NULL
               AND m.left_at IS NULL) AS member
     FROM accounts a WHERE a.id = $1 FOR UPDATE OF a`,
    [accountId, circleId],
  );
  return r.rows[0] ?? null;
}

// The join checks and the insert inside the caller's transaction, after it has locked the circle row.
export async function joinLocked(
  tx: Queryable,
  accountId: string,
  c: LockedCircle,
  name: string,
  viaInvite: boolean,
  now: Date,
): Promise<JoinResult> {
  if (c.status !== 'open' || c.hidden_at) return { status: 'closed' };
  const a = isUuid(accountId) ? await lockJoiner(tx, accountId, c.id) : null;
  const group = a ? ageGroupFor(a.dob, now) : null;
  if (!a || !group) return { status: 'capability' };
  const verdict = canJoin({
    group,
    consent: a.consent_state,
    circleKind: c.kind,
    circleHasChild: await circleHasChild(tx, c.id),
    viaInvite,
    memberCount: await memberCount(tx, c.id),
    accountCircleCount: a.circles,
    alreadyMember: a.member,
    circleOpen: c.status === 'open',
    circleHidden: c.hidden_at !== null,
  });
  if (!verdict.ok) return { status: verdict.reason };
  // A member who left comes back on their old row (one row per circle and account).
  await tx.query(
    `INSERT INTO circle_members (circle_id, account_id, display_name, joined_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (circle_id, account_id, COALESCE(profile_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET left_at = NULL, role = 'member', joined_at = EXCLUDED.joined_at, display_name = EXCLUDED.display_name`,
    [c.id, accountId, name, now.toISOString()],
  );
  return { status: 'joined', slug: c.slug };
}

export async function joinCircle(
  db: Db,
  accountId: string,
  circleId: string,
  yourName: unknown,
  viaInvite: boolean,
  now: Date,
): Promise<JoinResult> {
  const name = cleanMemberName(yourName);
  if (!name) return { status: 'name' };
  return db.transaction(async (tx) => {
    const c = await lockCircleById(tx, circleId);
    return c ? joinLocked(tx, accountId, c, name, viaInvite, now) : { status: 'closed' };
  });
}
