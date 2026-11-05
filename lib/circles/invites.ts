// Circle invites (plan 4B, spec Project 4 "Invites" and "Circle rules"). A link invite is reusable until revoked; each
// member has at most one active link per circle and making a new one revokes theirs (regenerate). An email invite is
// single use and expires 14 days after creation. Tokens are 32 random bytes (base64url), stored only as sha256 hashes.
// An invite works only while its circle is open and visible and its creator is still a member. Reading an invite
// (previewInvite) changes nothing; only acceptInvite, a signed-in POST, uses one up. A token decides the circle: no
// circle id from a request is ever read. No Next.js imports. Verified by tests/unit/circles-invites.test.ts.
import { randomBytes } from 'node:crypto';
import type { Db, Queryable } from '@/lib/db';
import { isUuid } from '@/lib/accounts/pin';
import { ageGroupFor, can, type Consent } from '@/lib/accounts/policy';
import { normalizeEmail } from '@/lib/accounts/signup';
import { hash } from '@/lib/tokens';
import { circleHasChild } from './children';
import { pruneAddressLog } from './invite-guard';
import { joinLocked, lockCircleById, type JoinResult } from './join';
import { cleanMemberName, type CircleKind } from './rules';
import { lockCircle, memberCount, myRole, type CircleRow } from './repo';

const DAY = 86_400_000;
const HOUR = 3_600_000;

export const INVITE_LIMITS = {
  emailsPerDay: 10,
  perAddress: 3,
  emailDays: 14,
  keepDays: 14,
} as const;

// What the injected sender gets; the web layer turns it into the email (links, unsubscribe).
export type InviteMail = {
  to: string;
  token: string;
  inviterName: string;
  circleName: string;
  recipientAccountId: string | null;
};
export type InvitePreview = {
  circleName: string;
  kind: CircleKind;
  memberCount: number;
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const isInviteToken = (v: unknown): v is string => typeof v === 'string' && TOKEN.test(v);
// The only return path sign-up and sign-in carry: an invite page, nothing else (never an open redirect).
export const inviteReturnPath = (raw: unknown): string | null => {
  const m = typeof raw === 'string' ? /^\/circles\/join\/([^/]+)\/$/.exec(raw) : null;
  return m && isInviteToken(m[1]) ? (raw as string) : null;
};
const newInviteToken = (): string => randomBytes(32).toString('base64url');
const iso = (d: Date) => d.toISOString();

// Usable invite `i` of circle `c` at $2: not revoked, not used, not expired, circle open and visible, creator a member;
// and in a circle holding a child profile, made by the owner (ruling, 4B security review: only the owner of a circle
// with a child decides who is invited, so a member's earlier invite stops working once a child is added).
const USABLE = `i.revoked_at IS NULL AND i.used_at IS NULL AND (i.expires_at IS NULL OR i.expires_at > $2::timestamptz)
  AND c.status = 'open' AND c.hidden_at IS NULL
  AND EXISTS (SELECT 1 FROM circle_members m WHERE m.circle_id = i.circle_id AND m.account_id = i.created_by
              AND m.profile_id IS NULL AND m.left_at IS NULL)
  AND (i.created_by = c.owner_account_id
       OR NOT EXISTS (SELECT 1 FROM circle_members k WHERE k.circle_id = i.circle_id AND k.profile_id IS NOT NULL
                      AND k.left_at IS NULL))`;

type Inviter = { circle: CircleRow; circleName: string; yourName: string };

// The circle locked for an invite by `accountId`: a current member of a visible circle with the `invite` capability, and
// its owner when the circle holds a child profile (ruling). Lock order: the circle row, then the account row (FOR UPDATE
// on the email path, so one account's concurrent sends across circles count against the daily cap one at a time).
async function asInviter(
  tx: Queryable,
  accountId: string,
  slug: string,
  now: Date,
  accountLock: 'SHARE' | 'UPDATE' = 'SHARE',
): Promise<Inviter | 'not_allowed' | 'closed'> {
  const c = isUuid(accountId) ? await lockCircle(tx, slug) : null;
  if (!c || c.hidden_at) return 'not_allowed';
  const r = await tx.query<{
    name: string;
    dn: string;
    dob: string;
    consent_state: Consent;
  }>(
    `SELECT c.name, m.display_name AS dn, to_char(a.date_of_birth, 'YYYY-MM-DD') AS dob, a.consent_state
     FROM circle_members m JOIN circles c ON c.id = m.circle_id JOIN accounts a ON a.id = m.account_id
     WHERE m.circle_id = $1 AND m.account_id = $2 AND m.profile_id IS NULL AND m.left_at IS NULL FOR ${accountLock} OF a`,
    [c.id, accountId],
  );
  const row = r.rows[0];
  const group = row ? ageGroupFor(row.dob, now) : null;
  if (!row || !group || !can(group, row.consent_state, 'invite')) return 'not_allowed';
  if (c.owner_account_id !== accountId && (await circleHasChild(tx, c.id))) return 'not_allowed';
  return c.status === 'open' ? { circle: c, circleName: row.name, yourName: row.dn } : 'closed';
}

async function insertInvite(
  tx: Queryable,
  circleId: string,
  accountId: string,
  now: Date,
  email: string | null,
): Promise<string> {
  const token = newInviteToken();
  await tx.query(
    `INSERT INTO circle_invites (circle_id, created_by, kind, token_hash, invited_email, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      circleId,
      accountId,
      email ? 'email' : 'link',
      hash(token),
      email,
      iso(now),
      email ? iso(new Date(now.getTime() + INVITE_LIMITS.emailDays * DAY)) : null,
    ],
  );
  return token;
}

// Revokes the caller's own active link for the circle (if any) and mints a new one.
export async function createLinkInvite(
  db: Db,
  accountId: string,
  slug: string,
  now: Date,
): Promise<{ status: 'created'; token: string } | { status: 'not_allowed' | 'closed' }> {
  return db.transaction(async (tx) => {
    const who = await asInviter(tx, accountId, slug, now);
    if (typeof who === 'string') return { status: who };
    await tx.query(
      "UPDATE circle_invites SET revoked_at = $3 WHERE circle_id = $1 AND created_by = $2 AND kind = 'link' AND revoked_at IS NULL",
      [who.circle.id, accountId, iso(now)],
    );
    return {
      status: 'created',
      token: await insertInvite(tx, who.circle.id, accountId, now, null),
    };
  });
}

type EmailOutcome = 'invalid' | 'not_allowed' | 'closed' | 'limit' | 'duplicate';

// The daily per-account cap, an active invite to the same address, and the per-address cap (revoked invites keep their
// address until the daily purge, so the cap counts the recent ones).
async function emailRefusal(
  tx: Queryable,
  circleId: string,
  accountId: string,
  email: string,
  now: Date,
): Promise<EmailOutcome | null> {
  const r = await tx.query<{ today: number; active: number; same: number }>(
    `SELECT
       (SELECT count(*)::int FROM circle_invites WHERE created_by = $1 AND kind = 'email' AND created_at > $4::timestamptz) AS today,
       (SELECT count(*)::int FROM circle_invites WHERE circle_id = $2 AND invited_email = $3 AND revoked_at IS NULL
          AND used_at IS NULL AND expires_at > $5::timestamptz) AS active,
       (SELECT count(*)::int FROM circle_invites WHERE circle_id = $2 AND invited_email = $3) AS same`,
    [accountId, circleId, email, iso(new Date(now.getTime() - DAY)), iso(now)],
  );
  const { today, active, same } = r.rows[0];
  if (today >= INVITE_LIMITS.emailsPerDay) return 'limit';
  if (active > 0) return 'duplicate';
  return same >= INVITE_LIMITS.perAddress ? 'limit' : null;
}

// Records a single-use invite and mails it. An address whose account turned invite email off gets nothing, and the
// sender still sees 'sent' (so neither the answer nor its timing says whether an address has an account). The send is
// started, not awaited; a failed send is logged by error name only and the invite stays (the sender may revoke it).
export async function createEmailInvite(
  db: Db,
  accountId: string,
  slug: string,
  email: unknown,
  now: Date,
  send: (m: InviteMail) => Promise<unknown>,
): Promise<'sent' | EmailOutcome> {
  const to = normalizeEmail(email);
  if (!to) return 'invalid';
  const made = await db.transaction(async (tx) => {
    const who = await asInviter(tx, accountId, slug, now, 'UPDATE');
    if (typeof who === 'string') return who;
    const refused = await emailRefusal(tx, who.circle.id, accountId, to, now);
    if (refused) return refused;
    const token = await insertInvite(tx, who.circle.id, accountId, now, to);
    const r = await tx.query<{ id: string; notify_invites: boolean }>(
      'SELECT id, notify_invites FROM accounts WHERE email = $1',
      [to],
    );
    const mail: InviteMail = {
      to,
      token,
      inviterName: who.yourName,
      circleName: who.circleName,
      recipientAccountId: r.rows[0]?.id ?? null,
    };
    return { mail, quiet: r.rows[0]?.notify_invites === false };
  });
  if (typeof made === 'string') return made;
  // Never awaited: waiting for the provider only when mail goes out would tell, by timing, whether the address has an
  // account with invite email off. The send keeps lib/email.ts's bounded timeout; errors are logged by name only.
  if (!made.quiet) {
    void Promise.resolve()
      .then(() => send(made.mail))
      .catch((err: Error) => console.error('circle invite email not sent:', err?.name));
  }
  return 'sent';
}

// The circle's owner may revoke any of its invites; a member only their own. False when nothing was revoked.
export async function revokeInvite(
  db: Db,
  accountId: string,
  slug: string,
  inviteId: string,
  now: Date,
): Promise<boolean> {
  if (!isUuid(accountId) || !isUuid(inviteId)) return false;
  return db.transaction(async (tx) => {
    const c = await lockCircle(tx, slug);
    const role = c ? await myRole(tx, c.id, accountId) : null;
    if (!c || !role) return false;
    const r = await tx.query(
      `UPDATE circle_invites SET revoked_at = $4
       WHERE id = $1 AND circle_id = $2 AND revoked_at IS NULL AND used_at IS NULL AND (created_by = $3 OR $5)`,
      [inviteId, c.id, accountId, iso(now), role === 'owner'],
    );
    return (r.rowCount ?? 0) > 0;
  });
}

export type ListedInvite = {
  id: string;
  kind: 'link' | 'email';
  by: string;
  email: string | null;
  expiresAt: Date | null;
};
export type InviteSection = {
  canInvite: boolean;
  link: string | null;
  hasLink: boolean;
  invites: ListedInvite[];
};

// The invite section of a circle page, or null for a non-member. A member sees their own active invites (with the
// address they typed); the owner sees every active invite, other members' without the address. `flash` is the link
// token just minted for this browser: it is shown only when it is the viewer's own active link in this circle.
export async function listInvites(
  db: Queryable,
  accountId: string,
  slug: string,
  now: Date,
  flash: string | null,
): Promise<InviteSection | null> {
  const c = isUuid(accountId)
    ? await db.query<{ id: string; status: string; hidden_at: Date | null }>(
        'SELECT id, status, hidden_at FROM circles WHERE slug = $1',
        [slug],
      )
    : null;
  const circle = c?.rows[0];
  const role = circle && !circle.hidden_at ? await myRole(db, circle.id, accountId) : null;
  if (!circle || !role) return null;
  const who = await db.query<{ dob: string; consent_state: Consent }>(
    "SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS dob, consent_state FROM accounts WHERE id = $1",
    [accountId],
  );
  const group = ageGroupFor(who.rows[0].dob, now);
  const ownerOnly = role !== 'owner' && (await circleHasChild(db, circle.id));
  const canInvite = circle.status === 'open' && !ownerOnly && group !== null && can(group, who.rows[0].consent_state, 'invite');
  const r = await db.query<{
    id: string;
    kind: 'link' | 'email';
    created_by: string;
    token_hash: string;
    dn: string;
    invited_email: string | null;
    expires_at: Date | null;
  }>(
    `SELECT i.id, i.kind, i.created_by, i.token_hash, m.display_name AS dn, i.invited_email, i.expires_at
     FROM circle_invites i JOIN circles c ON c.id = i.circle_id
     JOIN circle_members m ON m.circle_id = i.circle_id AND m.account_id = i.created_by AND m.profile_id IS NULL
     WHERE i.circle_id = $1 AND (i.created_by = $3 OR $4) AND ${USABLE}
     ORDER BY i.created_at, i.id`,
    [circle.id, iso(now), accountId, role === 'owner'],
  );
  const mine = r.rows.filter((i) => i.created_by === accountId && i.kind === 'link');
  const shown = isInviteToken(flash) && mine.some((i) => i.token_hash === hash(flash)) ? flash : null;
  return {
    canInvite,
    link: shown,
    hasLink: mine.length > 0,
    invites: r.rows.map((i) => ({
      id: i.id,
      kind: i.kind,
      by: i.dn,
      email: i.created_by === accountId ? i.invited_email : null,
      expiresAt: i.expires_at,
    })),
  };
}

// Read-only: name, kind and member count of the circle behind a usable token, or null. Never changes the invite.
export async function previewInvite(db: Queryable, token: string, now: Date): Promise<InvitePreview | null> {
  if (!isInviteToken(token)) return null;
  const r = await db.query<{ id: string; name: string; kind: CircleKind }>(
    `SELECT c.id, c.name, c.kind FROM circle_invites i JOIN circles c ON c.id = i.circle_id
     WHERE i.token_hash = $1 AND ${USABLE}`,
    [hash(token), iso(now)],
  );
  const c = r.rows[0];
  return c
    ? {
        circleName: c.name,
        kind: c.kind,
        memberCount: await memberCount(db, c.id),
      }
    : null;
}

// Counts a page view of the invite. An upper bound: chat-app previews, scanners and crawlers open links too.
export async function recordOpen(db: Queryable, token: string): Promise<void> {
  if (isInviteToken(token)) {
    await db.query('UPDATE circle_invites SET opens = opens + 1 WHERE token_hash = $1', [hash(token)]);
  }
}

// A referral: the account was created in the last hour and this is its first circle. Holds no names.
async function recordReferral(
  tx: Queryable,
  inviteId: string,
  accountId: string,
  circleId: string,
  now: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO referrals (invite_id, new_account_id, joined_at)
     SELECT $1, $2, $3 FROM accounts a
     WHERE a.id = $2 AND a.created_at > $4::timestamptz
       AND NOT EXISTS (SELECT 1 FROM circle_members m WHERE m.account_id = $2 AND m.circle_id <> $5)
     ON CONFLICT (new_account_id) DO NOTHING`,
    [inviteId, accountId, iso(now), iso(new Date(now.getTime() - HOUR)), circleId],
  );
}

// Joins the circle behind the token under the shared join rules. Invalid, revoked, expired, used or foreign tokens all
// answer 'invalid'. An email invite is used up (and its address dropped) by a successful join.
export async function acceptInvite(
  db: Db,
  accountId: string,
  token: string,
  yourName: unknown,
  now: Date,
): Promise<JoinResult | { status: 'invalid' }> {
  const name = cleanMemberName(yourName);
  if (!name) return { status: 'name' };
  if (!isInviteToken(token)) return { status: 'invalid' };
  const h = hash(token);
  return db.transaction(async (tx) => {
    const found = await tx.query<{ circle_id: string }>('SELECT circle_id FROM circle_invites WHERE token_hash = $1', [
      h,
    ]);
    const c = found.rows[0] ? await lockCircleById(tx, found.rows[0].circle_id) : null;
    const r = c
      ? await tx.query<{ id: string; kind: 'link' | 'email' }>(
          `SELECT i.id, i.kind FROM circle_invites i JOIN circles c ON c.id = i.circle_id
           WHERE i.token_hash = $1 AND ${USABLE} FOR UPDATE OF i`,
          [h, iso(now)],
        )
      : null;
    const invite = r?.rows[0];
    if (!c || !invite) return { status: 'invalid' as const };
    const joined = await joinLocked(tx, accountId, c, name, true, now);
    if (joined.status !== 'joined') return joined;
    if (invite.kind === 'email') {
      await tx.query('UPDATE circle_invites SET used_at = $2, used_by = $3, invited_email = NULL WHERE id = $1', [
        invite.id,
        iso(now),
        accountId,
      ]);
    }
    await recordReferral(tx, invite.id, accountId, c.id, now);
    return joined;
  });
}

// Daily: drops the address of every spent invite (used, revoked or expired), then deletes invites spent more than 14
// days ago unless a referral points at them, then prunes the per-address send log older than 8 days. Each of the first
// two steps touches at most `cap` rows; returns the rows changed.
export async function purgeExpiredInvites(db: Queryable, now: Date, cap = 500): Promise<number> {
  const nulled = await db.query(
    `UPDATE circle_invites SET invited_email = NULL WHERE id IN (
       SELECT id FROM circle_invites WHERE invited_email IS NOT NULL
         AND (revoked_at IS NOT NULL OR used_at IS NOT NULL OR expires_at <= $1::timestamptz) LIMIT $2)`,
    [iso(now), cap],
  );
  const deleted = await db.query(
    `DELETE FROM circle_invites WHERE id IN (
       SELECT i.id FROM circle_invites i WHERE LEAST(i.revoked_at, i.used_at, i.expires_at) < $1::timestamptz
         AND NOT EXISTS (SELECT 1 FROM referrals r WHERE r.invite_id = i.id) LIMIT $2)`,
    [iso(new Date(now.getTime() - INVITE_LIMITS.keepDays * DAY)), cap],
  );
  return (nulled.rowCount ?? 0) + (deleted.rowCount ?? 0) + (await pruneAddressLog(db, now));
}
