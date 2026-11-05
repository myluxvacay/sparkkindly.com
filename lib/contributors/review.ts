// The reviewer agent's side of contributions (plan 8 Task 2): the queue the reviewer-role agent reads and the verdict
// it posts. AI output is untrusted: the verdict is validated with a closed schema (an unknown field is refused), must
// name the contribution's current revision, and can at most move it to needs_owner (item in_review); only the owner's
// admin action approves. A pass that does not show its work (no source opened for a Sourced item, no plagiarism search)
// counts as a fail. Contribution text reaches the agent only inside each entry's `item`; no account id, email or display
// name is ever returned. No Next.js imports. Verified by tests/unit/contributors-review-api.test.ts.
import { z } from 'zod';
import { audit } from '@/lib/admin/audit';
import { linkBase } from '@/lib/admin/sessions';
import { isUuid } from '@/lib/accounts/pin';
import type { ApiResult } from '@/lib/agents/api';
import type { Agent } from '@/lib/agents/auth';
import { parseVerdict, type Tier } from '@/lib/agents/verdict';
import { plainReason } from '@/lib/comments/moderation';
import type { Db, Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { transitionTx } from '@/lib/items/repo';
import { changesEmail } from './notices';
import { toSubmission, type DraftContent } from './rules';

export const QUEUE_LIMIT = 5;

type Row = { id: string; revision: number; kind: 'article' | 'quiz'; slug: string; world: string; goals: string | null; content: DraftContent; tier: string; item_id: string };

export async function contributionQueue(db: Queryable, now: Date) {
  const r = await db.query<Row>(
    `SELECT c.id, c.revision, c.kind, c.slug, w.slug AS world, w.goals, c.content, i.risk_tier AS tier, c.item_id
     FROM contributions c JOIN worlds w ON w.id = c.world_id JOIN items i ON i.id = c.item_id
     WHERE c.state = 'agent_review' ORDER BY c.submitted_at, c.id LIMIT $1`,
    [QUEUE_LIMIT],
  );
  const out = [];
  for (const c of r.rows) {
    const titles = await db.query<{ title: string }>(
      'SELECT title FROM items WHERE world_id = (SELECT world_id FROM items WHERE id = $1) AND id <> $1 ORDER BY created_at DESC, id LIMIT 30',
      [c.item_id],
    );
    const item: Partial<ReturnType<typeof toSubmission>> = toSubmission(c, now);
    delete item.idempotencyKey;
    out.push({
      id: c.id,
      version: String(c.revision),
      tier: c.tier,
      world: { slug: c.world, goals: c.goals },
      recentTitles: titles.rows.map((t) => t.title),
      item,
    });
  }
  return out;
}

const verdictSchema = z.strictObject({
  id: z.string().max(100),
  version: z.string().min(1).max(20),
  pass: z.boolean(),
  reasons: z.array(z.string().trim().min(1).max(500)).max(10),
  sourcesChecked: z.array(z.url().startsWith('https://')).max(10),
  plagiarismChecked: z.boolean(),
  solvedAnswer: z.string().max(200).optional(),
});
type Input = z.infer<typeof verdictSchema>;

export type VerdictDeps = { env: EnvLike; send: (m: EmailMessage) => Promise<unknown> };
type Outcome = { result: ApiResult; mail?: EmailMessage };
const fail = (status: number, error: string): Outcome => ({ result: { status, json: { error } } });

const NOT_SHOWN = 'The automatic review could not confirm this piece. Please check that every source supports its claim and try again.';

// Reasons reach the contributor (page and email), so they are plain like moderation reasons (plan 8 review M3): a reason
// with link-like text, an @ or a control character is replaced by a fixed sentence, never passed on.
export const REASON_REPLACED = 'The automatic review found a problem it could not describe safely. Please check the piece against the guidelines.';
const plainReasons = (reasons: string[]) => reasons.map((r) => (plainReason(r) ? r : REASON_REPLACED));

// The decision the server takes from the agent's verdict: a pass only when it shows its work for the tier.
function decision(v: Input, tier: Tier): { pass: boolean; reasons: string[] } {
  if (!v.pass) return { pass: false, reasons: plainReasons(v.reasons) };
  try {
    parseVerdict({ pass: v.pass, reasons: v.reasons, sourcesChecked: v.sourcesChecked, solvedAnswer: v.solvedAnswer }, { tier });
  } catch {
    return { pass: false, reasons: [NOT_SHOWN] };
  }
  return v.plagiarismChecked ? { pass: true, reasons: [] } : { pass: false, reasons: [NOT_SHOWN] };
}

type Locked = { state: string; revision: number; item_id: string | null; tier: Tier; title: string; email: string };

async function decideIn(tx: Queryable, agent: Agent, v: Input, env: EnvLike): Promise<Outcome> {
  const r = await tx.query<Locked>(
    `SELECT c.state, c.revision, c.item_id, i.risk_tier AS tier, c.content->>'title' AS title, a.email
     FROM contributions c JOIN accounts a ON a.id = c.account_id LEFT JOIN items i ON i.id = c.item_id
     WHERE c.id = $1 FOR UPDATE OF c`,
    [v.id],
  );
  const c = r.rows[0];
  if (!c) return fail(404, 'not_found');
  if (c.state !== 'agent_review' || !c.item_id) return fail(409, 'wrong_state');
  if (String(c.revision) !== v.version) return fail(409, 'stale');
  if (c.tier === 'kids') return fail(409, 'wrong_state');
  const actor = `agent:${agent.name}`;
  const d = decision(v, c.tier);
  const review = { pass: d.pass, reasons: d.pass ? v.reasons : d.reasons, sourcesChecked: v.sourcesChecked, plagiarismChecked: v.plagiarismChecked, by: actor };
  if (d.pass) await transitionTx(tx, c.item_id, 'in_review', actor, 'reviewer agent passed the contribution');
  await tx.query("UPDATE items SET quality_report = quality_report || jsonb_build_object('review', $2::jsonb) WHERE id = $1", [
    c.item_id, JSON.stringify(review),
  ]);
  const state = d.pass ? 'needs_owner' : 'changes_requested';
  await tx.query('UPDATE contributions SET state = $2, review_reasons = $3::jsonb, updated_at = now() WHERE id = $1', [
    v.id, state, JSON.stringify(d.pass ? [] : d.reasons),
  ]);
  await audit(tx, actor, d.pass ? 'contribution.review_pass' : 'contribution.review_fail', `contribution:${v.id}`, { revision: c.revision });
  const mail = d.pass ? undefined : changesEmail({ to: c.email, title: c.title, notes: d.reasons, site: linkBase(env) });
  return { result: { status: 200, json: { id: v.id, state } }, mail };
}

export async function recordVerdict(db: Db, agent: Agent, input: unknown, deps: VerdictDeps): Promise<ApiResult> {
  if (agent.role !== 'reviewer') return { status: 403, json: { error: 'forbidden_agent' } };
  const parsed = verdictSchema.safeParse(input);
  if (!parsed.success) return { status: 400, json: { error: 'invalid_verdict', message: parsed.error.issues[0]?.message } };
  const v = parsed.data;
  if (!v.pass && v.reasons.length === 0) return { status: 400, json: { error: 'invalid_verdict', message: 'a fail needs a reason' } };
  if (!isUuid(v.id)) return { status: 404, json: { error: 'not_found' } };
  const out = await db.transaction((tx) => decideIn(tx, agent, v, deps.env));
  if (out.mail) {
    try {
      await deps.send(out.mail);
    } catch (err) {
      console.error('contribution changes email not sent:', (err as Error)?.name);
    }
  }
  return out.result;
}
