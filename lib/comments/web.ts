// The comment POSTs and the item-page section loader (plan 7A) as plain functions, in the style of lib/circles/web.ts.
// With ACCOUNTS_ENABLED or COMMENTS_ENABLED off every route is a 404 and no section loads. Each POST checks Origin and
// takes the author only from requireAdultContext(getContext) via asAdult: no session goes to sign-in, a child context
// gets 403, and any account id in the form is never read. Redirects carry an outcome code only, back to the item's own
// path (looked up from the item id; an unknown item goes home). A child context never gets a section: the loader
// returns null before reading any comment. No Next.js imports. Verified by tests/unit/comments-web.test.tsx.
import { seeOther } from '@/lib/admin/guard';
import { asAdult } from '@/lib/accounts/children-web';
import { getContext, type AccountContext } from '@/lib/accounts/context';
import { isUuid } from '@/lib/accounts/pin';
import { commentsEnabled } from '@/lib/config';
import type { Db, Queryable } from '@/lib/db';
import { visibleWhere } from '@/lib/public/reads';
import { formatDay } from '@/lib/public/dates';
import {
  commentsAllowedFor,
  deleteComment,
  editComment,
  listOwnPending,
  listPublishedComments,
  postComment,
  type PendingComment,
  type PublicComment,
} from './repo';
import { REPORT_MESSAGES } from './report-web';
import { mayComment } from './rules';
import { getTrust } from './trust';

export type CommentDeps = { db: Db; now: Date };
export type Viewer = 'anonymous' | 'member' | 'not_allowed' | 'banned';
export type CommentSectionData = {
  itemId: string;
  comments: PublicComment[];
  pending: PendingComment[];
  viewer: Viewer;
  needsName: boolean;
  now: Date;
};

const notFound = () => new Response('Not found', { status: 404 });

// The item's public path, for a visible item only; null otherwise.
async function itemPath(db: Queryable, itemId: string | null, now: Date): Promise<string | null> {
  if (!isUuid(itemId)) {
    return null;
  }
  const r = await db.query<{ w: string; s: string }>(
    `SELECT w.slug AS w, i.slug AS s FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE i.id = $3 AND ${visibleWhere('$1', '$2')}`,
    [now, ['kids', 'all', 'adults'], itemId],
  );
  const row = r.rows[0];
  return row ? `/${row.w}/${row.s}/` : null;
}

type Act = (ctx: AccountContext, form: URLSearchParams) => Promise<string>;

function handle(request: Request, d: CommentDeps, act: Act): Promise<Response> {
  if (!commentsEnabled()) {
    return Promise.resolve(notFound());
  }
  return asAdult(request, d, async (ctx, form) => {
    const code = await act(ctx, form);
    const path = await itemPath(d.db, form.get('item'), d.now);
    return seeOther(`${path ?? '/'}?c=${code}#result`);
  });
}

const field = (form: URLSearchParams, name: string) => form.get(name) ?? '';

export const postCommentRequest = (request: Request, d: CommentDeps) =>
  handle(request, d, async (ctx, form) => {
    const r = await postComment(
      d.db,
      ctx,
      {
        itemId: form.get('item'),
        parentId: form.get('parent'),
        body: form.get('body'),
        displayName: form.get('display_name') ?? undefined,
        guidelines: form.get('guidelines') ?? undefined,
      },
      d.now,
    );
    return r.status === 'refused' ? r.code : r.status;
  });

export const editCommentRequest = (request: Request, d: CommentDeps) =>
  handle(request, d, (ctx, form) => editComment(d.db, ctx.account.id, field(form, 'comment'), form.get('body'), d.now));

export const deleteCommentRequest = (request: Request, d: CommentDeps) =>
  handle(request, d, async (ctx, form) =>
    (await deleteComment(d.db, ctx.account.id, field(form, 'comment'), d.now)) ? 'deleted' : 'gone',
  );

// A context lookup that throws could be a child's session: fail closed (no section).
async function contextFor(db: Db, token: string | undefined, now: Date): Promise<AccountContext | null | 'deny'> {
  if (!token) {
    return null;
  }
  try {
    const ctx = await getContext(db, token, now);
    return ctx?.profile ? 'deny' : ctx;
  } catch (err) {
    console.error('comment section context lookup failed:', (err as Error)?.name);
    return 'deny';
  }
}

// What the item page's comment section shows, or null for no section at all (flags off, a child context, Kids items,
// comments switched off).
export async function loadCommentSection(
  db: Db,
  token: string | undefined,
  itemId: string,
  now: Date,
): Promise<CommentSectionData | null> {
  if (!commentsEnabled()) {
    return null;
  }
  const ctx = await contextFor(db, token, now);
  if (ctx === 'deny' || !(await commentsAllowedFor(db, itemId, now))) {
    return null;
  }
  const comments = await listPublishedComments(db, itemId, now, ctx?.account.id ?? null);
  const base = { itemId, comments, now };
  if (!ctx) {
    return { ...base, pending: [], viewer: 'anonymous', needsName: false };
  }
  const trust = await getTrust(db, ctx.account.id);
  const viewer: Viewer = !mayComment(ctx.account.ageGroup, ctx.account.consent) ? 'not_allowed' : trust.banned ? 'banned' : 'member';
  const pending = await listOwnPending(db, ctx.account.id, itemId, now);
  return { ...base, pending, viewer, needsName: trust.displayName === null };
}

const MIN = 60_000;
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

// "just now", "5 minutes ago", "3 hours ago", "2 days ago"; older than a week, the date.
export function relativeTime(at: Date, now: Date): string {
  const ms = now.getTime() - new Date(at).getTime();
  if (ms < MIN) return 'just now';
  if (ms < 60 * MIN) return plural(Math.floor(ms / MIN), 'minute');
  if (ms < 24 * 60 * MIN) return plural(Math.floor(ms / (60 * MIN)), 'hour');
  if (ms < 7 * 24 * 60 * MIN) return plural(Math.floor(ms / (24 * 60 * MIN)), 'day');
  return formatDay(at);
}

// Outcome messages for ?c= after a comment POST. Only these codes ever show text.
export const COMMENT_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  held: { text: 'Thank you. Your comment is waiting for review and will appear once approved.', ok: true },
  published: { text: 'Your comment is published.', ok: true },
  saved: { text: 'Your change is saved.', ok: true },
  deleted: { text: 'Your comment is deleted.', ok: true },
  gone: { text: 'That comment could not be deleted. It may already be gone.', ok: false },
  length: { text: 'A comment needs between 1 and 1,000 characters.', ok: false },
  blocked: { text: 'Please reword your comment: it contains a word we do not allow.', ok: false },
  link: { text: 'Links are not allowed in comments yet. Please remove the link and try again.', ok: false },
  duplicate: { text: 'That comment has already been posted.', ok: false },
  rate: { text: 'You have posted a lot of comments recently. Please try again later.', ok: false },
  not_allowed: { text: 'Comments are open to signed-in members aged 16 and over.', ok: false },
  comments_off: { text: 'Comments are switched off for this item.', ok: false },
  no_item: { text: 'That item was not found.', ok: false },
  no_parent: { text: 'That comment can no longer be replied to.', ok: false },
  name: { text: 'Please choose a display name of 1 to 30 characters, without an @ or a link.', ok: false },
  guidelines: { text: 'Please confirm that you have read the community guidelines.', ok: false },
  banned: { text: 'Your account can no longer post comments.', ok: false },
  too_late: { text: 'Comments can only be edited within 15 minutes of posting.', ok: false },
  not_found: { text: 'That comment was not found.', ok: false },
  ...REPORT_MESSAGES,
};
