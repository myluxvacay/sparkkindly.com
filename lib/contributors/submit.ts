// Submitting, withdrawing and account-deletion clean-up for contributions (plan 8). A submission runs the existing item
// gates (lib/items/gates.ts) on the contribution mapped to the agent format; on a pass the contribution waits for the
// reviewer agent with its item as a `draft` (nothing public, nothing scheduled). The slow source checks run outside any
// transaction; the write then re-locks the contribution and refuses if it changed meanwhile. Lock order everywhere:
// account (KEY SHARE), contribution, item. No Next.js imports. Verified by tests/unit/contributors-flow.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { requireAdultContext, type AccountContext } from '@/lib/accounts/context';
import { isUuid } from '@/lib/accounts/pin';
import { ticked } from '@/lib/comments/rules';
import { splitAnswer } from '@/lib/items/format';
import { riskTierFor, runGates } from '@/lib/items/gates';
import type { Probe } from '@/lib/items/probe';
import { insertItem, replaceContent, transitionTx, UnknownTopicError, type ItemContent, type Status } from '@/lib/items/repo';
import { eligibleContributor } from './profile';
import { CONTRIBUTOR_LIMITS, EDITABLE_STATES, PENDING_STATES, contributorLimits, toSubmission, type ContributorLimits, type DraftContent } from './rules';
import { nextState, type State } from './states';

export type SubmitCode =
  | 'not_allowed' | 'banned' | 'no_profile' | 'declarations' | 'rate' | 'not_found' | 'wrong_state' | 'pending_limit' | 'kids' | 'changed';
export type SubmitResult = { status: 'agent_review' } | { status: 'gates_failed'; reasons: string[] } | { status: 'refused'; code: SubmitCode };
export type SubmitDeps = { probe?: Probe; limits?: ContributorLimits };

type Locked = {
  id: string; account_id: string; state: State; kind: 'article' | 'quiz'; world_id: number; world: string; slug: string;
  content: DraftContent; revision: number; item_id: string | null; version: string;
};

const refuse = (code: SubmitCode): SubmitResult => ({ status: 'refused', code });
const CREATED_BY = 'contributor'; // items.created_by names no person; the link is contributions.item_id

async function load(tx: Queryable, accountId: string, id: string, lock: boolean): Promise<Locked | undefined> {
  const r = await tx.query<Locked>(
    `SELECT c.id, c.account_id, c.state, c.kind, c.world_id, w.slug AS world, c.slug, c.content, c.revision, c.item_id,
            c.updated_at::text AS version
     FROM contributions c JOIN worlds w ON w.id = c.world_id WHERE c.id = $1 AND c.account_id = $2${lock ? ' FOR UPDATE OF c' : ''}`,
    [id, accountId],
  );
  return r.rows[0];
}

const pendingCount = async (tx: Queryable, accountId: string, except: string) =>
  Number(
    (await tx.query<{ n: string }>('SELECT count(*) AS n FROM contributions WHERE account_id = $1 AND state = ANY($2) AND id <> $3', [
      accountId, [...PENDING_STATES], except,
    ])).rows[0].n,
  );

// The checks every phase repeats: who, which row, which state, Kids, the pending cap.
async function check(tx: Queryable, ctx: AccountContext | null, id: unknown, now: Date, lock: boolean): Promise<Locked | SubmitCode> {
  const who = await eligibleContributor(tx, ctx, now);
  if (!who.ok) return who.code;
  if (!(await tx.query('SELECT 1 FROM contributor_profiles WHERE account_id = $1', [who.accountId])).rows.length) return 'no_profile';
  if (!isUuid(id)) return 'not_found';
  const c = await load(tx, who.accountId, id, lock);
  if (!c) return 'not_found';
  if (!(EDITABLE_STATES as readonly string[]).includes(c.state)) return 'wrong_state';
  if (c.world === 'kids' || c.content.world === 'kids') return 'kids';
  if ((await pendingCount(tx, who.accountId, c.id)) >= CONTRIBUTOR_LIMITS.pending) return 'pending_limit';
  return c;
}

const contentOf = (sub: ReturnType<typeof toSubmission>, riskTier: ItemContent['riskTier'], report: unknown): ItemContent => {
  const { body, answer } = splitAnswer(sub);
  return { title: sub.title, summary: sub.summary, body, riskTier, sources: sub.sources, qualityReport: report, topics: sub.topics, answer };
};

// The item for a passing submission: created on the first pass, rewritten (as a revision) on a resubmission.
async function writeItem(tx: Queryable, c: Locked, content: ItemContent): Promise<string | 'wrong_state'> {
  if (!c.item_id) {
    const item = await insertItem(tx, {
      worldId: c.world_id, kind: c.kind, slug: c.slug, title: content.title, summary: content.summary, body: content.body,
      audience: 'all', status: 'draft', createdBy: CREATED_BY, riskTier: content.riskTier, sources: content.sources,
      qualityReport: content.qualityReport, image: { origin: 'template' }, topics: content.topics, answer: content.answer,
    });
    return item.id;
  }
  const s = await tx.query<{ status: Status }>('SELECT status FROM items WHERE id = $1 FOR UPDATE', [c.item_id]);
  if (s.rows[0]?.status === 'in_review') await transitionTx(tx, c.item_id, 'draft', CREATED_BY, 'contributor revision');
  const done = await replaceContent(tx, c.item_id, content, CREATED_BY, `contributor revision ${c.revision + 1}`);
  return done ? c.item_id : 'wrong_state';
}

async function applyPass(tx: Queryable, c: Locked, content: ItemContent, now: Date): Promise<SubmitResult> {
  const itemId = await writeItem(tx, c, content);
  if (itemId === 'wrong_state') return refuse('wrong_state');
  const to = nextState(nextState(c.state, 'submit')!, 'gates_pass');
  await tx.query(
    `UPDATE contributions SET state = $2, item_id = $3, revision = revision + 1, declared_at = $4, submitted_at = $4,
       gate_reasons = '[]', review_reasons = '[]', owner_notes = NULL, updated_at = $4 WHERE id = $1`,
    [c.id, to, itemId, now.toISOString()],
  );
  return { status: 'agent_review' };
}

async function applyFail(tx: Queryable, c: Locked, reasons: string[], now: Date): Promise<SubmitResult> {
  const to = nextState(nextState(c.state, 'submit')!, 'gates_fail');
  await tx.query('UPDATE contributions SET state = $2, gate_reasons = $3::jsonb, updated_at = $4 WHERE id = $1', [
    c.id, to, JSON.stringify(reasons), now.toISOString(),
  ]);
  return { status: 'gates_failed', reasons };
}

export async function submitContribution(
  db: Db,
  ctx: AccountContext | null,
  id: unknown,
  declarations: { original?: unknown; licence?: unknown },
  now: Date,
  deps: SubmitDeps = {},
): Promise<SubmitResult> {
  const first = await db.transaction(async (tx) => {
    const c = await check(tx, ctx, id, now, false);
    if (typeof c === 'string') return c;
    if (!ticked(declarations.original) || !ticked(declarations.licence)) return 'declarations' as const;
    if (!(deps.limits ?? contributorLimits).submit(c.account_id)) return 'rate' as const;
    return c;
  });
  if (typeof first === 'string') return refuse(first);

  const world = { id: first.world_id, slug: first.world };
  const sub = toSubmission({ ...first, revision: first.revision + 1 }, now);
  const gates = await runGates(db, sub, world, { probe: deps.probe, now, ignoreItemId: first.item_id ?? undefined });
  const riskTier = riskTierFor(sub, world);
  if (riskTier === 'kids') return refuse('kids');
  const report = { riskTier, decision: 'contributed: waits for the reviewer agent, then the owner', gates: gates.results };

  try {
    return await db.transaction(async (tx) => {
      const c = await check(tx, ctx, id, now, true);
      if (typeof c === 'string') return refuse(c);
      if (c.version !== first.version) return refuse('changed');
      if (!gates.ok) return applyFail(tx, c, gates.results.filter((g) => !g.ok).map((g) => `${g.gate}: ${g.reason ?? 'failed'}`), now);
      return applyPass(tx, c, contentOf(sub, riskTier, report), now);
    });
  } catch (err) {
    if (err instanceof UnknownTopicError) return { status: 'gates_failed', reasons: [`topics: unknown topic ${err.topics.join(', ')}`] };
    if ((err as { code?: string }).code === '23505') return { status: 'gates_failed', reasons: ['duplicate: that address is already used'] };
    throw err;
  }
}

// Takes an item out of every public and pending path: published or scheduled straight to archived, anything else via
// draft. The caller holds the contribution's lock.
async function archiveItem(tx: Queryable, itemId: string, by: string, reason: string): Promise<void> {
  const r = await tx.query<{ status: Status }>('SELECT status FROM items WHERE id = $1 FOR UPDATE', [itemId]);
  const status = r.rows[0]?.status;
  if (!status || status === 'archived') return;
  if (status === 'in_review' || status === 'rejected') await transitionTx(tx, itemId, 'draft', by, reason);
  await transitionTx(tx, itemId, 'archived', by, reason);
}

export type WithdrawResult = 'withdrawn' | 'not_found' | 'wrong_state';

// The contributor withdraws at any time, whatever their age group or ban: only their own adult context is needed.
export async function withdraw(db: Db, ctx: AccountContext | null, id: unknown, now: Date): Promise<WithdrawResult> {
  const adult = requireAdultContext(ctx);
  if (!adult || !isUuid(id)) return 'not_found';
  return db.transaction(async (tx) => {
    const c = await load(tx, adult.account.id, id, true);
    if (!c) return 'not_found';
    const to = nextState(c.state, 'withdraw');
    if (!to) return 'wrong_state';
    if (c.item_id) await archiveItem(tx, c.item_id, CREATED_BY, 'withdrawn by the contributor');
    await tx.query('UPDATE contributions SET state = $2, updated_at = $3 WHERE id = $1', [c.id, to, now.toISOString()]);
    return 'withdrawn';
  });
}

// Account deletion (lib/accounts/delete.ts), inside its transaction after the account row is locked: published items are
// archived (no byline remains once the contributions cascade), never-published items are deleted with their text.
export async function removeContributions(tx: Queryable, accountId: string): Promise<void> {
  const r = await tx.query<{ item_id: string | null }>('SELECT item_id FROM contributions WHERE account_id = $1 ORDER BY id FOR UPDATE', [accountId]);
  for (const { item_id } of r.rows) {
    if (!item_id) continue;
    const i = await tx.query<{ published_at: Date | null }>('SELECT published_at FROM items WHERE id = $1 FOR UPDATE', [item_id]);
    if (!i.rows[0]) continue;
    if (i.rows[0].published_at) await archiveItem(tx, item_id, 'system', 'contributor account deleted');
    else await tx.query('DELETE FROM items WHERE id = $1', [item_id]);
  }
}
