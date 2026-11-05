// Circles (plan 4A): create, list, the member view and leaving. The acting account id comes from the server-side context;
// age group and consent are re-derived from the stored account row. A slug from a URL or form only names a circle: every
// read and write also requires the caller's own current membership. Emails are never read here.
// No Next.js imports. Verified by tests/unit/circles-repo.test.ts.
import { randomInt } from 'node:crypto';
import type { Db, Queryable } from '@/lib/db';
import { isUuid } from '@/lib/accounts/pin';
import { ageGroupFor, type Consent } from '@/lib/accounts/policy';
import { LIMITS, canCreateKind, validateCircleInput, type CircleInput, type CircleKind } from './rules';

export type Role = 'owner' | 'member';
export type CircleSummary = { slug: string; name: string; kind: CircleKind; role: Role; memberCount: number };
// accountId and profileId are given to the owner (for the owner forms) and for the caller's own rows; otherwise null.
export type CircleMember = {
  accountId: string | null;
  profileId: string | null;
  name: string;
  role: Role;
  isChild: boolean;
  isYou: boolean;
  isMine: boolean;
};
export type CircleView = {
  slug: string;
  name: string;
  kind: CircleKind;
  description: string | null;
  timeZone: string;
  status: 'open' | 'closed';
  myRole: Role;
  members: CircleMember[];
};
export type CircleRow = {
  id: string;
  kind: CircleKind;
  status: 'open' | 'closed';
  owner_account_id: string | null;
  hidden_at: Date | null;
};
export type CreateResult = { status: 'created'; slug: string } | { status: 'invalid' | 'not_allowed' | 'limit' };

const SLUG = /^[a-z0-9]{10}$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const isSlug = (v: unknown): v is string => typeof v === 'string' && SLUG.test(v);

// 10 characters from a CSPRNG (about 51 bits): unguessable, and never derived from the name.
export const newSlug = (): string => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

// Locks the circle row for an owner or member write (the first lock any circle write takes), or null.
export async function lockCircle(tx: Queryable, slug: string): Promise<CircleRow | null> {
  if (!isSlug(slug)) {
    return null;
  }
  const r = await tx.query<CircleRow>(
    'SELECT id, kind, status, owner_account_id, hidden_at FROM circles WHERE slug = $1 FOR UPDATE',
    [slug],
  );
  return r.rows[0] ?? null;
}

// Current members: accounts and child profiles that have not left.
export async function memberCount(tx: Queryable, circleId: string): Promise<number> {
  const r = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM circle_members WHERE circle_id = $1 AND left_at IS NULL',
    [circleId],
  );
  return r.rows[0].n;
}

// The caller's own current account membership role in a circle, or null.
export async function myRole(tx: Queryable, circleId: string, accountId: string): Promise<Role | null> {
  const r = await tx.query<{ role: Role }>(
    'SELECT role FROM circle_members WHERE circle_id = $1 AND account_id = $2 AND profile_id IS NULL AND left_at IS NULL',
    [circleId, accountId],
  );
  return r.rows[0]?.role ?? null;
}

type Holder = { dob: string; consent_state: Consent; time_zone: string };

async function lockHolder(tx: Queryable, accountId: string): Promise<Holder | null> {
  const r = await tx.query<Holder>(
    "SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS dob, consent_state, time_zone FROM accounts WHERE id = $1 FOR UPDATE",
    [accountId],
  );
  return r.rows[0] ?? null;
}

async function atLimit(tx: Queryable, accountId: string): Promise<boolean> {
  const r = await tx.query<{ owned: number; member: number }>(
    `SELECT count(*) FILTER (WHERE c.owner_account_id = $1)::int AS owned, count(*)::int AS member
     FROM circle_members m JOIN circles c ON c.id = m.circle_id
     WHERE m.account_id = $1 AND m.profile_id IS NULL AND m.left_at IS NULL AND c.status = 'open'`,
    [accountId],
  );
  return r.rows[0].owned >= LIMITS.ownedOpen || r.rows[0].member >= LIMITS.memberOf;
}

async function insertCircle(tx: Queryable, accountId: string, v: CircleInput): Promise<{ id: string; slug: string }> {
  for (;;) {
    const slug = newSlug();
    const r = await tx.query<{ id: string }>(
      `INSERT INTO circles (slug, name, kind, description, owner_account_id, time_zone)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [slug, v.name, v.kind, v.description, accountId, v.timeZone],
    );
    if (r.rows[0]) {
      return { id: r.rows[0].id, slug };
    }
  }
}

export async function createCircle(db: Db, accountId: string, input: unknown, now: Date): Promise<CreateResult> {
  if (!isUuid(accountId)) {
    return { status: 'not_allowed' };
  }
  return db.transaction(async (tx) => {
    // The account row lock serialises this account's creates, so the limit counts cannot race.
    const a = await lockHolder(tx, accountId);
    const group = a ? ageGroupFor(a.dob, now) : null;
    if (!a || !group || !canCreateKind(group, a.consent_state, 'friends')) {
      return { status: 'not_allowed' };
    }
    const v = validateCircleInput(input, a.time_zone);
    if (!v.ok) {
      return { status: 'invalid' };
    }
    if (!canCreateKind(group, a.consent_state, v.value.kind)) {
      return { status: 'not_allowed' };
    }
    if (await atLimit(tx, accountId)) {
      return { status: 'limit' };
    }
    const c = await insertCircle(tx, accountId, v.value);
    await tx.query(
      "INSERT INTO circle_members (circle_id, account_id, role, display_name, joined_at) VALUES ($1, $2, 'owner', $3, $4)",
      [c.id, accountId, v.value.yourName, now.toISOString()],
    );
    return { status: 'created', slug: c.slug };
  });
}

export async function listMyCircles(db: Queryable, accountId: string): Promise<CircleSummary[]> {
  if (!isUuid(accountId)) {
    return [];
  }
  const r = await db.query<{ slug: string; name: string; kind: CircleKind; role: Role; n: number }>(
    `SELECT c.slug, c.name, c.kind, m.role,
            (SELECT count(*)::int FROM circle_members x WHERE x.circle_id = c.id AND x.left_at IS NULL) AS n
     FROM circle_members m JOIN circles c ON c.id = m.circle_id
     WHERE m.account_id = $1 AND m.profile_id IS NULL AND m.left_at IS NULL AND c.status = 'open' AND c.hidden_at IS NULL
     ORDER BY c.name, c.slug`,
    [accountId],
  );
  return r.rows.map((c) => ({ slug: c.slug, name: c.name, kind: c.kind, role: c.role, memberCount: c.n }));
}

type MemberRow = { account_id: string; profile_id: string | null; display_name: string; role: Role };

// Null unless the caller is a current member of a visible (not hidden) circle. Closed circles stay readable.
export async function getCircleForMember(db: Queryable, accountId: string, slug: string): Promise<CircleView | null> {
  if (!isUuid(accountId) || !isSlug(slug)) {
    return null;
  }
  const c = await db.query<{ id: string; name: string; kind: CircleKind; description: string | null; time_zone: string; status: 'open' | 'closed' }>(
    'SELECT id, name, kind, description, time_zone, status FROM circles WHERE slug = $1 AND hidden_at IS NULL',
    [slug],
  );
  const circle = c.rows[0];
  const role = circle ? await myRole(db, circle.id, accountId) : null;
  if (!circle || !role) {
    return null;
  }
  const m = await db.query<MemberRow>(
    `SELECT account_id, profile_id, display_name, role FROM circle_members
     WHERE circle_id = $1 AND left_at IS NULL ORDER BY joined_at, account_id, profile_id NULLS FIRST`,
    [circle.id],
  );
  return {
    slug,
    name: circle.name,
    kind: circle.kind,
    description: circle.description,
    timeZone: circle.time_zone,
    status: circle.status,
    myRole: role,
    members: m.rows.map((r) => member(r, accountId, role === 'owner')),
  };
}

function member(r: MemberRow, viewer: string, owner: boolean): CircleMember {
  const mine = r.account_id === viewer;
  const ids = owner || mine;
  return {
    accountId: ids ? r.account_id : null,
    profileId: ids ? r.profile_id : null,
    name: r.display_name,
    role: r.role,
    isChild: r.profile_id !== null,
    isYou: mine && r.profile_id === null,
    isMine: mine,
  };
}

// An owner transfers or closes first. Leaving also takes the account's child profiles out of the circle.
export async function leaveCircle(
  db: Db,
  accountId: string,
  slug: string,
  now: Date,
): Promise<'left' | 'owner_must_transfer' | 'not_member'> {
  if (!isUuid(accountId)) {
    return 'not_member';
  }
  return db.transaction(async (tx) => {
    const c = await lockCircle(tx, slug);
    const role = c ? await myRole(tx, c.id, accountId) : null;
    if (!c || !role) {
      return 'not_member';
    }
    if (role === 'owner') {
      return 'owner_must_transfer';
    }
    await tx.query('UPDATE circle_members SET left_at = $3 WHERE circle_id = $1 AND account_id = $2 AND left_at IS NULL', [
      c.id,
      accountId,
      now.toISOString(),
    ]);
    return 'left';
  });
}
