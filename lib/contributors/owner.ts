// The owner's side of contributions (plan 8 Task 3): the queue shown in /admin/contributions/ and the decisions the
// admin actions apply (lib/admin/actions.ts runs them inside its audited transaction; approval goes through the shared
// scheduling path there, and item.approve refuses a contributed item). Owner approval is the only way past needs_owner. The contributor's display name is
// shown to the owner; never an email or account id. Notes reach the contributor by email (notes only, never the
// reviewer's transcript). No Next.js imports. Verified by tests/unit/contributors-owner.test.ts.
import type { Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import { transitionTx } from '@/lib/items/repo';
import { changesEmail, rejectedEmail } from './notices';
import type { DraftContent } from './rules';
import { nextState, type State } from './states';

export type OwnerEntry = DraftContent & {
  id: string;
  version: string; // updated_at as text: the admin form sends it back, so a changed contribution is refused
  itemId: string;
  revision: number;
  contributor: string;
  tier: string;
  reviewReasons: string[];
  submittedAt: Date | null;
};

type QueueRow = {
  id: string;
  item_id: string;
  revision: number;
  content: DraftContent;
  world: string;
  name: string;
  tier: string;
  reasons: unknown;
  submitted_at: Date | null;
  version: string;
};

export async function ownerContributionQueue(db: Queryable): Promise<OwnerEntry[]> {
  const r = await db.query<QueueRow>(
    `SELECT c.id, c.item_id, c.revision, c.content, w.slug AS world, p.display_name AS name, i.risk_tier AS tier,
            i.quality_report->'review'->'reasons' AS reasons, c.submitted_at, c.updated_at::text AS version
     FROM contributions c JOIN worlds w ON w.id = c.world_id JOIN items i ON i.id = c.item_id
     JOIN contributor_profiles p ON p.account_id = c.account_id
     WHERE c.state = 'needs_owner' ORDER BY c.submitted_at, c.id LIMIT 50`,
  );
  return r.rows.map((x) => ({
    ...x.content,
    world: x.world,
    id: x.id,
    version: x.version,
    itemId: x.item_id,
    revision: x.revision,
    contributor: x.name,
    tier: x.tier,
    reviewReasons: Array.isArray(x.reasons) ? x.reasons.map(String) : [],
    submittedAt: x.submitted_at,
  }));
}

export async function pendingLinks(db: Queryable): Promise<{ slug: string; displayName: string; link: string }[]> {
  const r = await db.query<{ slug: string; display_name: string; link: string }>(
    'SELECT slug, display_name, link FROM contributor_profiles WHERE link IS NOT NULL AND NOT link_approved ORDER BY updated_at, slug LIMIT 50',
  );
  return r.rows.map((x) => ({ slug: x.slug, displayName: x.display_name, link: x.link }));
}

type Locked = { state: State; item_id: string | null; title: string; email: string; version: string };

// Locks the contribution (its item is locked after it by the callers: contribution before item, as everywhere).
export async function lockContribution(tx: Queryable, id: string): Promise<Locked | null> {
  const r = await tx.query<Locked>(
    `SELECT c.state, c.item_id, c.content->>'title' AS title, a.email, c.updated_at::text AS version
     FROM contributions c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1 FOR UPDATE OF c`,
    [id],
  );
  return r.rows[0] ?? null;
}

// Called by contribution.approve (the contribution already locked) after its item was scheduled.
export async function markApproved(tx: Queryable, id: string): Promise<void> {
  await tx.query("UPDATE contributions SET state = 'approved', updated_at = now() WHERE id = $1 AND state = 'needs_owner'", [id]);
}

export const isContributed = async (tx: Queryable, itemId: string): Promise<boolean> =>
  (await tx.query('SELECT 1 FROM contributions WHERE item_id = $1', [itemId])).rows.length > 0;

export type OwnerResult = { status: 'done'; mail: EmailMessage } | { status: 'not_found' | 'wrong_state' | 'changed' };

// request_changes (item back to draft for the contributor's revision) or reject (item rejected), with the owner's note.
export async function ownerDecision(
  tx: Queryable,
  admin: { email: string },
  id: string,
  decision: 'request_changes' | 'reject',
  note: string,
  site: string,
  version: string,
): Promise<OwnerResult> {
  const c = await lockContribution(tx, id);
  if (!c) return { status: 'not_found' };
  if (c.version !== version) return { status: 'changed' };
  const to = nextState(c.state, decision);
  if (!to || c.state !== 'needs_owner' || !c.item_id) return { status: 'wrong_state' };
  await transitionTx(tx, c.item_id, decision === 'reject' ? 'rejected' : 'draft', admin.email, `owner: ${decision}`);
  await tx.query('UPDATE contributions SET state = $2, owner_notes = $3, updated_at = now() WHERE id = $1', [id, to, note]);
  const mail =
    decision === 'reject'
      ? rejectedEmail({ to: c.email, title: c.title, reason: note, site })
      : changesEmail({ to: c.email, title: c.title, notes: [note], site });
  return { status: 'done', mail };
}

// Approves exactly the link the owner was shown (the form carries it): if the contributor changed it since, nothing is
// approved ('changed'). Changing a link always resets its approval (lib/contributors/profile.ts).
export async function approveLink(tx: Queryable, slug: string, link: string): Promise<'done' | 'changed' | 'not_found'> {
  const r = await tx.query(
    'UPDATE contributor_profiles SET link_approved = true, updated_at = now() WHERE slug = $1 AND link = $2 AND NOT link_approved',
    [slug, link],
  );
  if (r.rowCount === 1) return 'done';
  const pending = await tx.query('SELECT 1 FROM contributor_profiles WHERE slug = $1 AND link IS NOT NULL AND NOT link_approved', [slug]);
  return pending.rows.length ? 'changed' : 'not_found';
}
