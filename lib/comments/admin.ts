// What /admin/comments/ reads (plan 7A): the world switches (never Kids: comments are never offered there), the items
// whose switch differs from their world, and one account's comment trust found through one of its comments. No email,
// account id or comment text is read for the trust lookup. No Next.js imports. Verified by tests/unit/comments-web.test.tsx.
import type { Queryable } from '@/lib/db';
import { uuidOf } from '@/lib/accounts/pin';

export type CommentSwitches = {
  worlds: { slug: string; name: string; enabled: boolean }[];
  items: { path: string; title: string; enabled: boolean }[];
};
export type CommentTrustView = {
  comment: string;
  displayName: string | null;
  level: number;
  approved: number;
  rejected: number;
  banned: boolean;
};

const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// A comment id, or a comment link (…#comment-<id>) the owner pasted; null otherwise.
export const commentRef = (v: unknown): string | null => (typeof v === 'string' ? uuidOf(UUID_IN.exec(v)?.[0]) : null);

export async function commentSwitches(db: Queryable): Promise<CommentSwitches> {
  const w = await db.query<{ slug: string; name: string; enabled: boolean }>(
    "SELECT slug, name, comments_enabled AS enabled FROM worlds WHERE slug <> 'kids' ORDER BY sort, slug",
  );
  const i = await db.query<{ w: string; s: string; title: string; enabled: boolean }>(
    `SELECT w.slug AS w, i.slug AS s, i.title, i.comments_enabled AS enabled FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE i.comments_enabled IS NOT NULL AND w.slug <> 'kids' ORDER BY w.slug, i.slug LIMIT 200`,
  );
  return { worlds: w.rows, items: i.rows.map((x) => ({ path: `/${x.w}/${x.s}/`, title: x.title, enabled: x.enabled })) };
}

// The author of a comment, for the owner's trust actions; null for an unknown comment.
export async function commentAuthor(q: Queryable, ref: unknown): Promise<{ comment: string; accountId: string } | null> {
  const id = commentRef(ref);
  if (!id) {
    return null;
  }
  const r = await q.query<{ a: string }>('SELECT account_id AS a FROM comments WHERE id = $1', [id]);
  return r.rows[0] ? { comment: id, accountId: r.rows[0].a } : null;
}

export async function trustByComment(db: Queryable, ref: unknown): Promise<CommentTrustView | null> {
  const id = commentRef(ref);
  if (!id) {
    return null;
  }
  const r = await db.query<{ dn: string | null; level: number | null; approved: number | null; rejected: number | null; banned: boolean | null }>(
    `SELECT t.display_name AS dn, t.level, t.approved, t.rejected, t.banned
     FROM comments c LEFT JOIN account_trust t ON t.account_id = c.account_id WHERE c.id = $1`,
    [id],
  );
  const t = r.rows[0];
  if (!t) {
    return null;
  }
  return {
    comment: id,
    displayName: t.dn,
    level: t.level ?? 0,
    approved: t.approved ?? 0,
    rejected: t.rejected ?? 0,
    banned: t.banned ?? false,
  };
}
