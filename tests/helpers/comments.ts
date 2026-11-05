// Fixtures shared by the comment moderation tests (plan 7B): signed-in people, items and comment rows written straight
// into the test database. Only example.test addresses.
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { getContext, type AccountContext } from '@/lib/accounts/context';
import type { Db } from '@/lib/db';

const T0 = new Date('2026-11-01T08:00:00Z');
let n = 0;

export type Person = { id: string; email: string; session: string; ctx: AccountContext };

export async function person(db: Db, now: Date, dateOfBirth = '1990-05-05', parentEmail?: string): Promise<Person> {
  const email = `mod${n++}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const r = await signUp(db, { email, dateOfBirth, parentEmail }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, T0))!, T0))!;
  return { id: r.accountId, email, session, ctx: (await getContext(db, session, now))! };
}

export async function item(db: Db, world = 'play', title = 'An item'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     SELECT id, 'article', $2, $3, 'S', '{}'::jsonb, 'all', 'published', '2026-10-31T00:00:00Z', 'test', 'reflective', 'test'
     FROM worlds WHERE slug = $1 RETURNING id`,
    [world, `mod-item-${n++}`, title],
  );
  return r.rows[0].id;
}

export async function comment(db: Db, itemId: string, accountId: string, body: string, status = 'published', at?: Date): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO comments (item_id, account_id, body, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), COALESCE($5::timestamptz, now())) RETURNING id`,
    [itemId, accountId, status === 'deleted' ? '' : body, status, at ?? null],
  );
  return r.rows[0].id;
}

export async function setLevel(db: Db, accountId: string, level: 0 | 1): Promise<void> {
  await db.query(
    `INSERT INTO account_trust (account_id, level, display_name) VALUES ($1, $2, 'Sam')
     ON CONFLICT (account_id) DO UPDATE SET level = EXCLUDED.level`,
    [accountId, level],
  );
}

export const statusOf = async (db: Db, id: string): Promise<string | undefined> =>
  (await db.query<{ status: string }>('SELECT status FROM comments WHERE id = $1', [id])).rows[0]?.status;

export const trustRow = async (db: Db, accountId: string) =>
  (
    await db.query<{ level: number; approved: number; rejected: number; false_reports: number; reports_muted: boolean }>(
      'SELECT level, approved, rejected, false_reports, reports_muted FROM account_trust WHERE account_id = $1',
      [accountId],
    )
  ).rows[0];

// An enabled moderation agent that has fetched its queue (last_run_at far in the future), so level-1 comments publish at
// once (hold-everything, lib/comments/hold.ts). Tests of the hold itself use their own agents.
export async function activeModerator(db: Db): Promise<void> {
  await db.query(
    `INSERT INTO agents (name, key_prefix, key_hash, role, last_run_at)
     VALUES ('fixture-moderator', 'fix00000', repeat('0', 64), 'moderation', '2100-01-01T00:00:00Z') ON CONFLICT (name) DO NOTHING`,
  );
}
