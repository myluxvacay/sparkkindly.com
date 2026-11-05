// The moderation agent's side (plan 7B, spec Project 7 "Moderation agent"): the queue it reads and the decisions it
// recommends. AI output is untrusted: decide() validates the input with a closed schema (unknown fields dropped),
// locks the author's trust row and the comment (7A lock order), re-checks that the decision applies to the comment's
// current state, that the agent saw its current version (an author edit after the queue read makes it stale), that an
// approved author is not banned and that the text still passes the mechanical checks, then applies the effects and
// writes an audit row with actor agent:<name>. A repeated decision returns the current state with no second effect.
// Comment text, item titles and report notes reach the agent only inside each entry's `data`; no account id, email or
// display name is ever returned. No Next.js imports. Verified by tests/unit/comments-moderation.test.ts.
import { z } from 'zod';
import { audit } from '@/lib/admin/audit';
import { linkBase } from '@/lib/admin/sessions';
import { isUuid } from '@/lib/accounts/pin';
import { unsubscribeSecret } from '@/lib/accounts/unsubscribe';
import type { ApiResult } from '@/lib/agents/api';
import type { Agent } from '@/lib/agents/auth';
import type { Db, Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { appealToken } from './appeals';
import { checkComment } from './checks';
import { APPLIES, applyDecision, type Decision, type Kind, type Locked } from './decisions';
import { rejectionEmail } from './rejection-email';
import { lockTrust } from './trust';

export { SAMPLE_RATE, pickForSample } from './sample';

export type QueueEntry = {
  id: string;
  version: string;
  reason: Kind;
  world: string;
  authorTrust: { level: number; approved: number; rejected: number };
  data: { itemTitle: string; body: string; reports: { reason: string; note: string | null; urgent: boolean }[] };
};

// Not escalated (those wait for the owner), and one of: held; hidden with open reports; a sample not yet reviewed.
const KIND_SQL = `CASE
  WHEN c.escalated_at IS NOT NULL THEN NULL
  WHEN c.status = 'held' THEN 'held'
  WHEN c.status = 'hidden' AND EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id AND r.handled_at IS NULL) THEN 'reported'
  WHEN c.status = 'published' AND EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id AND r.handled_at IS NULL AND r.urgent) THEN 'reported'
  WHEN c.status = 'published' AND c.sampled_at IS NOT NULL AND c.sample_reviewed_at IS NULL THEN 'sample'
END`;
const ORDER: Record<Kind, number> = { held: 0, reported: 1, sample: 2 };

type QueueRow = { id: string; version: string; kind: Kind; world: string; title: string; body: string; level: number; approved: number; rejected: number };

// `now` is accepted for symmetry with the other moderation calls; the queue has no time window.
export async function moderationQueue(db: Queryable, _now: Date, limit = 20): Promise<QueueEntry[]> {
  const r = await db.query<QueueRow>(
    `SELECT * FROM (
       SELECT c.id, c.updated_at::text AS version, ${KIND_SQL} AS kind, w.slug AS world, i.title, c.body, c.created_at,
              COALESCE(t.level, 0) AS level, COALESCE(t.approved, 0) AS approved, COALESCE(t.rejected, 0) AS rejected
       FROM comments c JOIN items i ON i.id = c.item_id JOIN worlds w ON w.id = i.world_id
       LEFT JOIN account_trust t ON t.account_id = c.account_id
       WHERE c.status IN ('held', 'hidden') OR (c.sampled_at IS NOT NULL AND c.sample_reviewed_at IS NULL)
          OR (c.status = 'published' AND EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id AND r.handled_at IS NULL AND r.urgent))
     ) q WHERE kind IS NOT NULL
     ORDER BY CASE kind WHEN 'held' THEN ${ORDER.held} WHEN 'reported' THEN ${ORDER.reported} ELSE ${ORDER.sample} END, created_at, id
     LIMIT $1`,
    [Math.min(Math.max(1, limit), 20)],
  );
  const reports = await db.query<{ c: string; reason: string; note: string | null; urgent: boolean }>(
    `SELECT comment_id AS c, reason, note, urgent FROM comment_reports
     WHERE comment_id = ANY($1::uuid[]) AND handled_at IS NULL ORDER BY created_at, id`,
    [r.rows.map((x) => x.id)],
  );
  return r.rows.map((x) => ({
    id: x.id,
    version: x.version,
    reason: x.kind,
    world: x.world,
    authorTrust: { level: x.level, approved: x.approved, rejected: x.rejected },
    data: {
      itemTitle: x.title,
      body: x.body,
      reports: reports.rows.filter((p) => p.c === x.id).map((p) => ({ reason: p.reason, note: p.note, urgent: p.urgent })),
    },
  }));
}

const NEEDS_REASON: Decision[] = ['reject', 'hide', 'escalate'];
const inputSchema = z.object({
  id: z.string().max(100),
  version: z.string().min(1).max(100),
  decision: z.enum(['approve', 'reject', 'escalate', 'keep', 'hide']),
  reason: z.string().trim().min(1).max(300).optional(),
});
type Input = z.infer<typeof inputSchema>;

export type DecideDeps = { env: EnvLike; send: (m: EmailMessage) => Promise<unknown> };
type Outcome = { result: ApiResult; mail?: { to: string; body: string; accountId: string } };

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Outcome => ({ result: { status, json: { error, ...extra } } });

type Row = { account_id: string; status: string; body: string; version: string; kind: Kind | null };

// The author's account (KEY SHARE) and trust row, then the comment, all locked; null when any is gone.
async function lockComment(tx: Queryable, id: string): Promise<(Row & { banned: boolean }) | null> {
  const a = await tx.query<{ a: string }>('SELECT account_id AS a FROM comments WHERE id = $1', [id]);
  const author = a.rows[0]?.a;
  if (!author || !(await tx.query('SELECT 1 FROM accounts WHERE id = $1 FOR KEY SHARE', [author])).rows.length) return null;
  const trust = await lockTrust(tx, author);
  const r = await tx.query<Row>(
    `SELECT c.account_id, c.status, c.body, c.updated_at::text AS version, ${KIND_SQL} AS kind FROM comments c WHERE c.id = $1 FOR UPDATE`,
    [id],
  );
  const row = r.rows[0];
  return row && row.account_id === author ? { ...row, banned: trust.banned } : null;
}

async function lastDecisionBy(tx: Queryable, id: string, actor: string): Promise<string | undefined> {
  const r = await tx.query<{ action: string }>('SELECT action FROM audit_log WHERE target = $1 AND actor = $2 ORDER BY id DESC LIMIT 1', [
    `comment:${id}`,
    actor,
  ]);
  return r.rows[0]?.action;
}

// The 7A checks that do not count the comment itself (rate and duplicate were checked when it was posted).
const approvable = (row: Row & { banned: boolean }, level: number) =>
  checkComment({ body: row.body, trustLevel: level >= 1 ? 1 : 0, recent: { sameBodyByAuthor24h: false, sameBodyOnItem: false, last10min: 0, last24h: 0 } });

async function decideIn(tx: Queryable, agent: Agent, input: Input, now: Date): Promise<Outcome> {
  const actor = `agent:${agent.name}`;
  const row = await lockComment(tx, input.id);
  if (!row) return fail(404, 'not_found');
  const reply = (status: string, extra: Record<string, unknown> = {}): ApiResult => ({
    status: 200,
    json: { id: input.id, status, decision: input.decision, ...extra },
  });
  if (!row.kind || !APPLIES[input.decision].includes(row.kind)) {
    if ((await lastDecisionBy(tx, input.id, actor)) === `comment.${input.decision}`) return { result: reply(row.status, { replayed: true }) };
    return fail(409, 'wrong_state', { status: row.status });
  }
  if (row.version !== input.version) return fail(409, 'stale');
  if (input.decision === 'approve' && row.banned) return fail(409, 'author_banned');
  if (input.decision === 'approve' && row.kind === 'held') {
    const level = (await tx.query<{ l: number }>('SELECT level AS l FROM account_trust WHERE account_id = $1', [row.account_id])).rows[0].l;
    const checked = approvable(row, level);
    if (!checked.ok) return fail(409, 'fails_checks', { check: checked.code });
  }
  const locked: Locked = { id: input.id, accountId: row.account_id, kind: row.kind, status: row.status };
  const effect = await applyDecision(tx, locked, { decision: input.decision, reason: input.reason ?? null, actor, now });
  await audit(tx, actor, `comment.${input.decision}`, `comment:${input.id}`, { from: row.kind, status: effect.status });
  if (!effect.mail) return { result: reply(effect.status) };
  const email = (await tx.query<{ email: string }>('SELECT email FROM accounts WHERE id = $1', [row.account_id])).rows[0].email;
  return { result: reply(effect.status), mail: { to: email, body: row.body, accountId: row.account_id } };
}

async function sendRejection(deps: DecideDeps, id: string, mail: NonNullable<Outcome['mail']>, reason: string, now: Date) {
  const site = linkBase(deps.env);
  const token = appealToken(unsubscribeSecret(deps.env), id, mail.accountId, now);
  if (!token) console.error('comment rejection email: no appeal secret configured; sent without an appeal link');
  try {
    await deps.send(rejectionEmail({ to: mail.to, body: mail.body, reason, site, appealUrl: token ? `${site}/comments/appeal/${token}/` : null }));
  } catch (err) {
    console.error('comment rejection email not sent:', (err as Error)?.name);
  }
}

export async function decide(db: Db, agent: Agent, input: unknown, now: Date, deps: DecideDeps): Promise<ApiResult> {
  if (agent.role !== 'moderation') return { status: 403, json: { error: 'forbidden_role' } };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: 400, json: { error: 'invalid_decision', message: parsed.error.issues[0]?.message } };
  const d = parsed.data;
  if (NEEDS_REASON.includes(d.decision) && !d.reason) return { status: 400, json: { error: 'reason_required' } };
  if (!isUuid(d.id)) return { status: 404, json: { error: 'not_found' } };
  const out = await db.transaction((tx) => decideIn(tx, agent, d, now));
  if (out.mail) await sendRejection(deps, d.id, out.mail, d.reason ?? '', now);
  return out.result;
}
