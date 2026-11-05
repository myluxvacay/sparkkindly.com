// Appeals (plan 7B, spec Project 7 "Appeals"). The rejection email carries a signed link bound to the comment id, the
// author's account id and an expiry 30 days out, signed with HMAC-SHA256 under UNSUBSCRIBE_SECRET with its own
// "appeal:v1" domain (ruling: no new server secret; a token of one kind never verifies as the other). Opening the link
// (GET) only reads; the POST behind it files one appeal per comment, for that author, while the comment is rejected
// or hidden. Ids in the form are never read: the token alone names the comment and the author. The owner decides in
// /admin/comments/ (decideAppeal, inside the admin action's transaction). No Next.js imports.
// Verified by tests/unit/comments-appeals.test.ts.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { clientKey, readForm, sameOrigin, seeOther } from '@/lib/admin/guard';
import { isUuid } from '@/lib/accounts/pin';
import { unsubscribeSecret } from '@/lib/accounts/unsubscribe';
import { createLimiter } from '@/lib/agents/rate-limit';
import { cleanNote } from '@/lib/circles/reports';
import { commentsEnabled } from '@/lib/config';
import type { Db, Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { appealOutcomeEmail } from './rejection-email';

export const APPEAL_DAYS = 30;
const MIN_SECRET = 32;
const APPEALABLE = ['rejected', 'hidden'];
export type FileResult = 'filed' | 'invalid' | 'duplicate' | 'expired';

const sign = (secret: string, c: string, a: string, exp: number) =>
  createHmac('sha256', secret).update(`appeal:v1:${c}:${a}:${exp}`).digest('base64url');

// "<comment id>.<account id>.<expiry, unix seconds>.<signature>", or null without a usable secret or with bad ids.
export function appealToken(secret: string, commentId: string, accountId: string, now: Date): string | null {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET || !isUuid(commentId) || !isUuid(accountId)) return null;
  const exp = Math.floor(now.getTime() / 1000) + APPEAL_DAYS * 86_400;
  return `${commentId}.${accountId}.${exp}.${sign(secret, commentId, accountId, exp)}`;
}

export function verifyAppealToken(
  secret: string,
  token: string,
  now: Date,
): { commentId: string; accountId: string } | 'invalid' | 'expired' {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET || typeof token !== 'string') return 'invalid';
  const [c, a, e, sig, ...rest] = token.split('.');
  if (rest.length || !isUuid(c) || !isUuid(a) || !/^\d{1,12}$/.test(e ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(sig ?? '')) return 'invalid';
  const given = Buffer.from(sig);
  const expected = Buffer.from(sign(secret, c, a, Number(e)));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'invalid';
  return Number(e) * 1000 < now.getTime() ? 'expired' : { commentId: c, accountId: a };
}

type Target = { status: string; appealed: boolean };

async function target(q: Queryable, commentId: string, accountId: string): Promise<Target | null> {
  const r = await q.query<Target>(
    `SELECT c.status, EXISTS (SELECT 1 FROM comment_appeals a WHERE a.comment_id = c.id) AS appealed
     FROM comments c WHERE c.id = $1 AND c.account_id = $2 AND (c.moderation_code IS NOT NULL OR c.moderation_reason IS NOT NULL)`,
    [commentId, accountId],
  );
  return r.rows[0] ?? null;
}

// What the GET page shows. Reads only.
export async function appealState(db: Queryable, secret: string, token: string, now: Date): Promise<'open' | 'filed' | 'invalid' | 'expired'> {
  const v = verifyAppealToken(secret, token, now);
  if (typeof v === 'string') return v;
  const t = await target(db, v.commentId, v.accountId);
  if (!t) return 'invalid';
  if (t.appealed) return 'filed';
  return APPEALABLE.includes(t.status) ? 'open' : 'invalid';
}

export async function fileAppeal(db: Db, secret: string, token: string, note: unknown, now: Date): Promise<FileResult> {
  const v = verifyAppealToken(secret, token, now);
  if (typeof v === 'string') return v;
  const clean = cleanNote(note);
  if (clean === false) return 'invalid';
  return db.transaction(async (tx) => {
    const lock = await tx.query<{ status: string }>('SELECT status FROM comments WHERE id = $1 AND account_id = $2 FOR UPDATE', [
      v.commentId,
      v.accountId,
    ]);
    const t = lock.rows[0] ? await target(tx, v.commentId, v.accountId) : null;
    if (!t || !APPEALABLE.includes(t.status)) return t?.appealed ? 'duplicate' : 'invalid';
    const r = await tx.query(
      'INSERT INTO comment_appeals (comment_id, account_id, note, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (comment_id) DO NOTHING',
      [v.commentId, v.accountId, clean, now],
    );
    return r.rowCount === 1 ? 'filed' : 'duplicate';
  });
}

// 20 appeal POSTs an hour per network address (createLimiter counts per minute; the clock runs 60x slow).
const shared = globalThis as unknown as { __sparkAppealLimiter?: (key: string) => boolean };
const appealLimiter = (shared.__sparkAppealLimiter ??= createLimiter({ perMinute: 20, now: () => Date.now() / 60 }));

export type AppealDeps = { db: Db; env: EnvLike; now: Date; limiter?: (key: string) => boolean };

// POST /comments/appeal/<token>/confirm/: the flags, Origin, the limiter, then fileAppeal. The note is the only field read.
export async function fileAppealRequest(request: Request, d: AppealDeps, token: string): Promise<Response> {
  if (!commentsEnabled()) return new Response('Not found', { status: 404 });
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
  if (!(d.limiter ?? appealLimiter)(clientKey(request))) {
    return new Response('Too many attempts. Please try again later.', { status: 429, headers: { 'Retry-After': '3600' } });
  }
  const form = await readForm(request);
  if (!form) return new Response('Payload too large or not a form', { status: 413 });
  const result = await fileAppeal(d.db, unsubscribeSecret(d.env), token, form.get('note') ?? undefined, d.now);
  return seeOther(`/comments/appeal/${encodeURIComponent(token)}/?a=${result}#result`);
}

export type AppealDecision = { status: 'done'; mail: EmailMessage } | { status: 'not_found' | 'decided' | 'gone' };

// The owner's decision on an open appeal. overturn: the comment is published again and the rejection it cost is taken
// back from the counts (rejected - 1; the level is the owner's to set by hand); uphold: nothing changes. Either way the
// author is told (the caller sends `mail` after the commit). A comment the author deleted meanwhile closes the appeal
// as upheld, with no email.
export async function decideAppeal(
  tx: Queryable,
  admin: { email: string },
  commentId: string,
  outcome: 'overturn' | 'uphold',
  now: Date,
  site = 'https://sparkkindly.com',
): Promise<AppealDecision> {
  if (!isUuid(commentId) || (outcome !== 'overturn' && outcome !== 'uphold')) return { status: 'not_found' };
  // The author's trust row first, as every other comment write does (lib/comments/repo.ts lock order).
  await tx.query('SELECT 1 FROM account_trust WHERE account_id = (SELECT account_id FROM comments WHERE id = $1) FOR UPDATE', [commentId]);
  const r = await tx.query<{ account_id: string; status: string; body: string; decided: boolean; email: string }>(
    `SELECT c.account_id, c.status, c.body, a.decided_at IS NOT NULL AS decided, acc.email
     FROM comment_appeals a JOIN comments c ON c.id = a.comment_id JOIN accounts acc ON acc.id = c.account_id
     WHERE a.comment_id = $1 FOR UPDATE OF a, c`,
    [commentId],
  );
  const row = r.rows[0];
  if (!row) return { status: 'not_found' };
  if (row.decided) return { status: 'decided' };
  const close = (o: string) => tx.query('UPDATE comment_appeals SET outcome = $2, decided_at = $3 WHERE comment_id = $1', [commentId, o, now]);
  if (!APPEALABLE.includes(row.status)) {
    await close('uphold');
    return { status: 'gone' };
  }
  await close(outcome);
  if (outcome === 'overturn') {
    await tx.query("UPDATE comments SET status = 'published', decided_by = $2 WHERE id = $1", [commentId, admin.email]);
    await tx.query('UPDATE account_trust SET rejected = greatest(rejected - 1, 0), updated_at = now() WHERE account_id = $1', [row.account_id]);
  }
  return { status: 'done', mail: appealOutcomeEmail({ to: row.email, body: row.body, outcome, site }) };
}
