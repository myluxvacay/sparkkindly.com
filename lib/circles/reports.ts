// Circle reports (plan 4D, spec Project 4 "Moderation"). A current account member whose account has join_circle reports
// their own (visible) circle: a reason and an optional note of up to 300 characters (blocked words are not applied to
// notes, so a report can quote what was said). 5 reports a rolling day per account. A child context never gets here:
// the POST is adult-context only (lib/circles/web.ts scoped). The site owner sees counts and notes in /admin/circles/
// (listReportedCircles: never an address or a member's name). No Next.js imports.
// Verified by tests/unit/circles-reports.test.ts.
import { seeOther } from '@/lib/admin/guard';
import { isUuid } from '@/lib/accounts/pin';
import { ageGroupFor, can, type Consent } from '@/lib/accounts/policy';
import type { Db, Queryable } from '@/lib/db';
import { isSlug } from './repo';
import { scoped, type CircleDeps } from './web';

export const REASONS = ['name', 'behaviour', 'safety', 'other'] as const;
export const REPORT_LIMIT = 5;
export const NOTE_MAX = 300;
export type ReportResult = 'reported' | 'invalid' | 'not_member' | 'limit' | 'not_allowed';

// Trimmed NFKC note of 1..300 characters without control or format characters; '' or absent is no note; else false.
export function cleanNote(v: unknown): string | null | false {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return false;
  const s = v.normalize('NFKC').trim();
  if (s === '') return null;
  return [...s].length <= NOTE_MAX && !/[\p{Cc}\p{Cf}]/u.test(s.replace(/\r?\n/g, ' ')) ? s : false;
}

type Reporter = { circle_id: string; dob: string; consent_state: Consent; recent: number };

async function reporter(tx: Queryable, accountId: string, slug: string, now: Date): Promise<Reporter | null> {
  const r = await tx.query<Reporter>(
    `SELECT c.id AS circle_id, to_char(a.date_of_birth, 'YYYY-MM-DD') AS dob, a.consent_state,
            (SELECT count(*)::int FROM circle_reports x
             WHERE x.reporter_account_id = a.id AND x.created_at > $3::timestamptz - interval '1 day') AS recent
     FROM circles c JOIN circle_members m ON m.circle_id = c.id JOIN accounts a ON a.id = m.account_id
     WHERE c.slug = $1 AND c.hidden_at IS NULL AND m.account_id = $2 AND m.profile_id IS NULL AND m.left_at IS NULL`,
    [slug, accountId, now.toISOString()],
  );
  return r.rows[0] ?? null;
}

export async function reportCircle(
  db: Db,
  accountId: string,
  slug: string,
  input: { reason: unknown; note?: unknown },
  now: Date,
): Promise<ReportResult> {
  if (!isUuid(accountId) || !isSlug(slug)) return 'not_member';
  const note = cleanNote(input.note);
  if (!REASONS.includes(input.reason as (typeof REASONS)[number]) || note === false) return 'invalid';
  return db.transaction(async (tx) => {
    // One account's reports count one after another, so two at once cannot pass the daily limit together.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`circle-report:${accountId}`]);
    const who = await reporter(tx, accountId, slug, now);
    if (!who) return 'not_member';
    const group = ageGroupFor(who.dob, now);
    if (!group || !can(group, who.consent_state, 'join_circle')) return 'not_allowed';
    if (who.recent >= REPORT_LIMIT) return 'limit';
    await tx.query(
      'INSERT INTO circle_reports (circle_id, reporter_account_id, reason, note, created_at) VALUES ($1, $2, $3, $4, $5)',
      [who.circle_id, accountId, input.reason, note, now.toISOString()],
    );
    return 'reported';
  });
}

const CODES: Record<ReportResult, string> = {
  reported: 'reported',
  invalid: 'report-invalid',
  not_member: 'report-no',
  limit: 'report-limit',
  not_allowed: 'report-no',
};

// POST /circles/<slug>/report/: flags, Origin, adult context, membership and the per-account allowance (scoped).
export const reportCircleRequest = (request: Request, d: CircleDeps, slug: string) =>
  scoped(request, d, slug, async (accountId, form) => {
    const r = await reportCircle(d.db, accountId, slug, { reason: form.get('reason'), note: form.get('note') }, d.now);
    return seeOther(`/circles/${slug}/?r=${CODES[r]}#result`);
  });

export type ReportedCircle = {
  id: string;
  name: string;
  kind: string;
  status: string;
  hidden: boolean;
  members: number;
  total: number;
  open: number;
  latestReason: string;
  latestNote: string | null;
  latestAt: Date;
};

// Circles with reports, those with unhandled reports first, then newest report first.
export async function listReportedCircles(db: Queryable, limit = 100): Promise<ReportedCircle[]> {
  const r = await db.query<ReportedCircle>(
    `SELECT c.id, c.name, c.kind, c.status, c.hidden_at IS NOT NULL AS hidden,
            (SELECT count(*)::int FROM circle_members m WHERE m.circle_id = c.id AND m.left_at IS NULL) AS members,
            count(r.id)::int AS total, (count(r.id) FILTER (WHERE r.handled_at IS NULL))::int AS open,
            (array_agg(r.reason ORDER BY r.created_at DESC, r.id DESC))[1] AS "latestReason",
            (array_agg(r.note ORDER BY r.created_at DESC, r.id DESC))[1] AS "latestNote",
            max(r.created_at) AS "latestAt"
     FROM circle_reports r JOIN circles c ON c.id = r.circle_id
     GROUP BY c.id
     ORDER BY (count(r.id) FILTER (WHERE r.handled_at IS NULL)) > 0 DESC, max(r.created_at) DESC
     LIMIT $1`,
    [limit],
  );
  return r.rows;
}
