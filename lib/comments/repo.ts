// Comments (plan 7A): posting, editing, deleting and the public listing. The acting account comes from the server-side
// context (posting) or the route's adult context (edit, delete); age group, consent, verification, ban and trust level
// are re-read from the stored rows. Item, parent and comment ids from a form only name rows: each is re-checked here.
// Every write runs in one transaction under the account's trust-row lock (lockTrust), so rate and duplicate counts
// cannot race. Lock order: the account row (FOR KEY SHARE, as the comment's foreign key would), then the trust row,
// matching account deletion (account row first, its cascade then takes the trust row).
// No Next.js imports. Verified by tests/unit/comments-repo.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { requireAdultContext, type AccountContext } from '@/lib/accounts/context';
import { isUuid } from '@/lib/accounts/pin';
import { ageGroupFor, type Consent } from '@/lib/accounts/policy';
import { visibleWhere } from '@/lib/public/reads';
import { checkComment, type CheckCode, type Recent } from './checks';
import { COMMENT_LIMITS, cleanDisplayName, mayComment, normaliseBody, ticked } from './rules';
import { pickForSample } from './sample';
import { lockTrust, type Trust } from './trust';
import { moderationActive } from './hold';

export type PostInput = { itemId: unknown; parentId?: unknown; body: unknown; displayName?: unknown; guidelines?: unknown };
export type RefusalCode = CheckCode | 'not_allowed' | 'comments_off' | 'no_item' | 'no_parent' | 'name' | 'guidelines' | 'banned';
export type PostResult = { status: 'held' | 'published'; id: string } | { status: 'refused'; code: RefusalCode };
export type EditResult = 'saved' | 'held' | 'too_late' | 'not_found' | 'banned' | 'comments_off' | CheckCode;
export type PublicComment = {
  id: string;
  parentId: string | null;
  displayName: string | null;
  body: string;
  createdAt: Date;
  deleted: boolean;
  mine: boolean;
};
export type PendingComment = { id: string; parentId: string | null; body: string; createdAt: Date };

const EVERY_AUDIENCE = ['kids', 'all', 'adults'];
// Same text for duplicate detection: case and runs of whitespace ignored. Used on both sides of every comparison.
const KEY = (expr: string) => `lower(regexp_replace(${expr}, '\\s+', ' ', 'g'))`;

// 'on' when the item is publicly visible and open for comments; Kids-world, audience=kids and kids-tier items never are.
async function itemState(q: Queryable, itemId: unknown, now: Date): Promise<'on' | 'off' | 'no_item'> {
  if (!isUuid(itemId)) {
    return 'no_item';
  }
  const r = await q.query<{ on: boolean }>(
    `SELECT (w.slug <> 'kids' AND i.audience <> 'kids' AND i.risk_tier <> 'kids'
             AND COALESCE(i.comments_enabled, w.comments_enabled)) AS on
     FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE i.id = $3 AND ${visibleWhere('$1', '$2')}`,
    [now, EVERY_AUDIENCE, itemId],
  );
  const row = r.rows[0];
  return row ? (row.on ? 'on' : 'off') : 'no_item';
}

export const commentsAllowedFor = async (db: Queryable, itemId: string, now = new Date()): Promise<boolean> =>
  (await itemState(db, itemId, now)) === 'on';

// The adult, verified account allowed `public_comment`, read and share-locked; null otherwise.
async function eligibleAccount(tx: Queryable, ctx: AccountContext | null, now: Date): Promise<string | null> {
  const adult = requireAdultContext(ctx);
  if (!adult || !isUuid(adult.account.id)) {
    return null;
  }
  const r = await tx.query<{ dob: string; consent_state: Consent; verified: boolean }>(
    `SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS dob, consent_state, verified_at IS NOT NULL AS verified
     FROM accounts WHERE id = $1 FOR KEY SHARE`,
    [adult.account.id],
  );
  const a = r.rows[0];
  return a && a.verified && mayComment(ageGroupFor(a.dob, now), a.consent_state) ? adult.account.id : null;
}

// A reply's parent: a top-level comment on the same item, published, or held and the replier's own.
async function parentOk(tx: Queryable, accountId: string, itemId: string, parentId: unknown): Promise<boolean> {
  if (!isUuid(parentId)) {
    return false;
  }
  const r = await tx.query(
    `SELECT 1 FROM comments WHERE id = $1 AND item_id = $2 AND parent_id IS NULL
       AND (status = 'published' OR (status = 'held' AND account_id = $3))`,
    [parentId, itemId, accountId],
  );
  return r.rows.length === 1;
}

async function recentFor(
  tx: Queryable,
  o: { accountId: string; itemId: string; body: string; now: Date; except?: string },
): Promise<Recent> {
  const r = await tx.query<{ a: boolean; i: boolean; m: number; d: number }>(
    `SELECT
       EXISTS (SELECT 1 FROM comments WHERE account_id = $1 AND created_at > $4::timestamptz - interval '24 hours'
               AND status <> 'deleted' AND id IS DISTINCT FROM $5 AND ${KEY('body')} = ${KEY('$3')}) AS a,
       EXISTS (SELECT 1 FROM comments WHERE item_id = $2 AND (status = 'published' OR (account_id = $1 AND status <> 'deleted'))
               AND id IS DISTINCT FROM $5 AND ${KEY('body')} = ${KEY('$3')}) AS i,
       (SELECT count(*)::int FROM comments WHERE account_id = $1 AND created_at > $4::timestamptz - interval '10 minutes'
          AND created_at <= $4) AS m,
       (SELECT count(*)::int FROM comments WHERE account_id = $1 AND created_at > $4::timestamptz - interval '24 hours'
          AND created_at <= $4) AS d`,
    [o.accountId, o.itemId, o.body, o.now, o.except ?? null],
  );
  const x = r.rows[0];
  return { sameBodyByAuthor24h: x.a, sameBodyOnItem: x.i, last10min: x.m, last24h: x.d };
}

// The display name and guidelines tick, required on the account's first comment only.
function firstUse(trust: Trust, input: PostInput): { name: string | null } | 'name' | 'guidelines' {
  if (trust.displayName) {
    return { name: null };
  }
  const name = cleanDisplayName(input.displayName);
  if (!name) {
    return 'name';
  }
  return ticked(input.guidelines) ? { name } : 'guidelines';
}

async function postIn(tx: Queryable, ctx: AccountContext | null, input: PostInput, now: Date): Promise<PostResult> {
  const refuse = (code: RefusalCode): PostResult => ({ status: 'refused', code });
  const accountId = await eligibleAccount(tx, ctx, now);
  if (!accountId) {
    return refuse('not_allowed');
  }
  const trust = await lockTrust(tx, accountId);
  if (trust.banned) {
    return refuse('banned');
  }
  const state = await itemState(tx, input.itemId, now);
  if (state !== 'on') {
    return refuse(state === 'off' ? 'comments_off' : 'no_item');
  }
  const itemId = input.itemId as string;
  const hasParent = input.parentId !== undefined && input.parentId !== null && input.parentId !== '';
  if (hasParent && !(await parentOk(tx, accountId, itemId, input.parentId))) {
    return refuse('no_parent');
  }
  const first = firstUse(trust, input);
  if (typeof first === 'string') {
    return refuse(first);
  }
  const body = normaliseBody(input.body) ?? '';
  const recent = await recentFor(tx, { accountId, itemId, body, now });
  const checked = checkComment({ body, trustLevel: trust.level, recent });
  if (!checked.ok) {
    return refuse(checked.code);
  }
  if (first.name) {
    await tx.query(
      'UPDATE account_trust SET display_name = $2, guidelines_accepted_at = $3, updated_at = $3 WHERE account_id = $1',
      [accountId, first.name, now],
    );
  }
  // Level 1 publishes at once only while the moderation agent is running (hold-everything, spec 4a.6).
  const status = trust.level === 1 && (await moderationActive(tx, now)) ? 'published' : 'held';
  const r = await tx.query<{ id: string }>(
    `INSERT INTO comments (item_id, account_id, parent_id, body, status, created_at, updated_at, sampled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7) RETURNING id`,
    [itemId, accountId, hasParent ? input.parentId : null, checked.body, status, now, status === 'published' && pickForSample() ? now : null],
  );
  return { status, id: r.rows[0].id };
}

// A parent or item deleted between the checks and the insert breaks a foreign key (23503): a refusal, not an error.
export async function postComment(db: Db, ctx: AccountContext | null, input: PostInput, now: Date): Promise<PostResult> {
  try {
    return await db.transaction((tx) => postIn(tx, ctx, input, now));
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    if (e.code !== '23503') throw err;
    return { status: 'refused', code: e.constraint?.includes('parent') ? 'no_parent' : 'no_item' };
  }
}

// The author's own held or published comment, within COMMENT_LIMITS.editMs of creation (exactly 15 minutes allowed).
// Every check runs again except the rate limit (an edit adds no comment); a level-0 author's edit is held again.
export async function editComment(db: Db, accountId: string, commentId: string, body: unknown, now: Date): Promise<EditResult> {
  if (!isUuid(accountId) || !isUuid(commentId)) {
    return 'not_found';
  }
  return db.transaction(async (tx) => {
    const found = await tx.query('SELECT 1 FROM accounts WHERE id = $1 FOR KEY SHARE', [accountId]);
    if (found.rows.length !== 1) {
      return 'not_found';
    }
    const trust = await lockTrust(tx, accountId);
    const r = await tx.query<{ item_id: string; status: string; created_at: Date }>(
      `SELECT item_id, status, created_at FROM comments
       WHERE id = $1 AND account_id = $2 AND status IN ('held', 'published') FOR UPDATE`,
      [commentId, accountId],
    );
    const c = r.rows[0];
    if (!c) {
      return 'not_found';
    }
    if (trust.banned) {
      return 'banned';
    }
    if (now.getTime() - new Date(c.created_at).getTime() > COMMENT_LIMITS.editMs) {
      return 'too_late';
    }
    if ((await itemState(tx, c.item_id, now)) !== 'on') {
      return 'comments_off';
    }
    const text = normaliseBody(body) ?? '';
    const recent = await recentFor(tx, { accountId, itemId: c.item_id, body: text, now, except: commentId });
    const checked = checkComment({ body: text, trustLevel: trust.level, recent: { ...recent, last10min: 0, last24h: 0 } });
    if (!checked.ok) {
      return checked.code;
    }
    const status = trust.level === 1 ? c.status : 'held';
    await tx.query('UPDATE comments SET body = $2, status = $3, updated_at = $4 WHERE id = $1', [commentId, checked.body, status, now]);
    return status === 'held' ? 'held' : 'saved';
  });
}

// The author's own held or published comment: the body is emptied and the row kept so replies keep their place. A
// hidden or rejected comment cannot be deleted (7A review M1): its replies stay hidden with it, never shown again under
// a deleted placeholder. Account deletion still removes it.
export async function deleteComment(db: Db, accountId: string, commentId: string, now: Date): Promise<boolean> {
  if (!isUuid(accountId) || !isUuid(commentId)) {
    return false;
  }
  const r = await db.query(
    `UPDATE comments SET status = 'deleted', body = '', updated_at = $3
     WHERE id = $1 AND account_id = $2 AND status IN ('held', 'published')`,
    [commentId, accountId, now],
  );
  return r.rowCount === 1;
}

type ListRow = { id: string; parent_id: string | null; status: string; name: string | null; body: string; created_at: Date; mine: boolean };

// Published comments of an item that allows comments, oldest first. A deleted top-level comment with a published reply
// stays as an empty placeholder (no name, no body). Replies whose parent is not shown are left out. No account id or
// email is ever selected; `mine` tells the viewer which comments are theirs.
export async function listPublishedComments(
  db: Queryable,
  itemId: string,
  now = new Date(),
  viewerId: string | null = null,
): Promise<PublicComment[]> {
  if ((await itemState(db, itemId, now)) !== 'on') {
    return [];
  }
  const r = await db.query<ListRow>(
    `SELECT c.id, c.parent_id, c.status, t.display_name AS name, c.body, c.created_at,
            COALESCE(c.account_id = $2::uuid, false) AS mine
     FROM comments c LEFT JOIN account_trust t ON t.account_id = c.account_id
     WHERE c.item_id = $1 AND (c.status = 'published' OR (c.status = 'deleted' AND c.parent_id IS NULL
       AND EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id AND r.status = 'published')))
     ORDER BY c.created_at, c.id`,
    [itemId, isUuid(viewerId) ? viewerId : null],
  );
  const shown = new Set(r.rows.filter((x) => x.parent_id === null).map((x) => x.id));
  return r.rows
    .filter((x) => x.parent_id === null || shown.has(x.parent_id))
    .map((x) => {
      const deleted = x.status === 'deleted';
      return {
        id: x.id,
        parentId: x.parent_id,
        displayName: deleted ? null : x.name,
        body: deleted ? '' : x.body,
        createdAt: x.created_at,
        deleted,
        mine: !deleted && x.mine,
      };
    });
}

// The account's own held comments on an item (shown to the author only, as "waiting for review").
export async function listOwnPending(db: Queryable, accountId: string, itemId: string, now = new Date()): Promise<PendingComment[]> {
  if (!isUuid(accountId) || (await itemState(db, itemId, now)) !== 'on') {
    return [];
  }
  const r = await db.query<{ id: string; parent_id: string | null; body: string; created_at: Date }>(
    `SELECT id, parent_id, body, created_at FROM comments
     WHERE item_id = $1 AND account_id = $2 AND status = 'held' ORDER BY created_at, id`,
    [itemId, accountId],
  );
  return r.rows.map((x) => ({ id: x.id, parentId: x.parent_id, body: x.body, createdAt: x.created_at }));
}
