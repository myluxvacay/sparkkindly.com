// Contribution drafts (plan 8): saving (private, at most 5 drafts, 10 saves an hour) and the contributor's own reads.
// A contribution id from a form only names a row; it is re-checked against the session's own account, so another
// member's contribution reads as not found. No Next.js imports. Verified by tests/unit/contributors-flow.test.ts.
import type { Db, Queryable } from '@/lib/db';
import type { AccountContext } from '@/lib/accounts/context';
import { isUuid } from '@/lib/accounts/pin';
import { eligibleContributor } from './profile';
import { CONTRIBUTOR_LIMITS, EDITABLE_STATES, contributorLimits, newItemSlug, parseDraft, type ContributorLimits, type DraftContent } from './rules';
import type { State } from './states';

export type SaveCode = 'not_allowed' | 'banned' | 'no_profile' | 'rate' | 'invalid' | 'draft_limit' | 'not_found' | 'wrong_state';
export type SaveResult = { status: 'saved'; id: string } | { status: 'refused'; code: SaveCode; errors?: string[] };
export type SaveDeps = { limits?: ContributorLimits };

const refuse = (code: SaveCode, errors?: string[]): SaveResult => ({ status: 'refused', code, ...(errors ? { errors } : {}) });

async function worldId(tx: Queryable, slug: string): Promise<number | null> {
  const r = await tx.query<{ id: number }>("SELECT id FROM worlds WHERE slug = $1 AND enabled AND slug <> 'kids'", [slug]);
  return r.rows[0]?.id ?? null;
}

async function saveIn(tx: Queryable, ctx: AccountContext | null, input: Record<string, unknown>, now: Date, limits: ContributorLimits): Promise<SaveResult> {
  const who = await eligibleContributor(tx, ctx, now);
  if (!who.ok) return refuse(who.code);
  if (!(await tx.query('SELECT 1 FROM contributor_profiles WHERE account_id = $1', [who.accountId])).rows.length) return refuse('no_profile');
  if (!limits.save(who.accountId)) return refuse('rate');
  const parsed = parseDraft(input);
  if (!parsed.ok) return refuse('invalid', parsed.errors);
  const world = await worldId(tx, parsed.value.world);
  if (world === null) return refuse('invalid', ['world: choose one of the worlds offered']);
  const content = JSON.stringify(parsed.value);
  if (input.id !== undefined && input.id !== null && input.id !== '') {
    if (!isUuid(input.id)) return refuse('not_found');
    const r = await tx.query<{ state: State }>('SELECT state FROM contributions WHERE id = $1 AND account_id = $2 FOR UPDATE', [input.id, who.accountId]);
    if (!r.rows[0]) return refuse('not_found');
    if (!(EDITABLE_STATES as readonly string[]).includes(r.rows[0].state)) return refuse('wrong_state');
    await tx.query('UPDATE contributions SET kind = $2, world_id = $3, content = $4::jsonb, updated_at = $5 WHERE id = $1', [
      input.id, parsed.value.kind, world, content, now.toISOString(),
    ]);
    return { status: 'saved', id: input.id };
  }
  const drafts = await tx.query<{ n: string }>("SELECT count(*) AS n FROM contributions WHERE account_id = $1 AND state = 'draft'", [who.accountId]);
  if (Number(drafts.rows[0].n) >= CONTRIBUTOR_LIMITS.drafts) return refuse('draft_limit');
  const r = await tx.query<{ id: string }>(
    `INSERT INTO contributions (account_id, state, kind, world_id, slug, content, created_at, updated_at)
     VALUES ($1, 'draft', $2, $3, $4, $5::jsonb, $6, $6) RETURNING id`,
    [who.accountId, parsed.value.kind, world, newItemSlug(parsed.value.title), content, now.toISOString()],
  );
  return { status: 'saved', id: r.rows[0].id };
}

export function saveDraft(db: Db, ctx: AccountContext | null, input: Record<string, unknown>, now: Date, deps: SaveDeps = {}): Promise<SaveResult> {
  return db.transaction((tx) => saveIn(tx, ctx, input, now, deps.limits ?? contributorLimits));
}

export type Mine = {
  id: string;
  kind: 'article' | 'quiz';
  world: string;
  state: State;
  revision: number;
  content: DraftContent;
  gateReasons: string[];
  reviewReasons: string[];
  ownerNotes: string | null;
  declaredAt: Date | null;
  submittedAt: Date | null;
  updatedAt: Date;
  itemPath: string | null; // only while the item is published
};

type Row = {
  id: string; kind: 'article' | 'quiz'; world: string; state: State; revision: number; content: DraftContent; gate_reasons: string[];
  review_reasons: string[]; owner_notes: string | null; declared_at: Date | null; submitted_at: Date | null; updated_at: Date;
  item_slug: string | null; item_status: string | null;
};

const SELECT = `SELECT c.id, c.kind, w.slug AS world, c.state, c.revision, c.content, c.gate_reasons, c.review_reasons, c.owner_notes,
    c.declared_at, c.submitted_at, c.updated_at, i.slug AS item_slug, i.status AS item_status
  FROM contributions c JOIN worlds w ON w.id = c.world_id LEFT JOIN items i ON i.id = c.item_id`;

const toMine = (r: Row): Mine => ({
  id: r.id, kind: r.kind, world: r.world, state: r.state, revision: r.revision, content: r.content, gateReasons: r.gate_reasons,
  reviewReasons: r.review_reasons, ownerNotes: r.owner_notes, declaredAt: r.declared_at, submittedAt: r.submitted_at,
  updatedAt: r.updated_at, itemPath: r.item_status === 'published' && r.item_slug ? `/${r.world}/${r.item_slug}/` : null,
});

export async function listMine(db: Queryable, accountId: string): Promise<Mine[]> {
  if (!isUuid(accountId)) return [];
  const r = await db.query<Row>(`${SELECT} WHERE c.account_id = $1 ORDER BY c.updated_at DESC, c.id`, [accountId]);
  return r.rows.map(toMine);
}

export async function getMine(db: Queryable, accountId: string, id: unknown): Promise<Mine | null> {
  if (!isUuid(accountId) || !isUuid(id)) return null;
  const r = await db.query<Row>(`${SELECT} WHERE c.id = $1 AND c.account_id = $2`, [id, accountId]);
  return r.rows[0] ? toMine(r.rows[0]) : null;
}
