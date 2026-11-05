// Shared fixtures for the circle set and score tests (plan 4C): worlds, topics, playable items, accounts and circles.
import type { Db } from '@/lib/db';
import { signUp } from '@/lib/accounts/signup';
import { createCircle } from '@/lib/circles/repo';
import { addChildToCircle } from '@/lib/circles/children';

let n = 0;
const T0 = new Date('2026-11-01T08:00:00Z');

export type Fixtures = { worlds: { a: number; b: number; c: number }; topics: { x: number; y: number } };

// Three worlds and two topics of the test's own, so each test file controls every candidate item.
export async function fixtures(db: Db): Promise<Fixtures> {
  const w = async (slug: string) =>
    (await db.query<{ id: number }>("INSERT INTO worlds (slug, name) VALUES ($1, $1) RETURNING id", [slug])).rows[0].id;
  const t = async (slug: string) =>
    (await db.query<{ id: number }>("INSERT INTO topics (slug, name) VALUES ($1, $1) RETURNING id", [slug])).rows[0].id;
  return { worlds: { a: await w('wa'), b: await w('wb'), c: await w('wc') }, topics: { x: await t('tx'), y: await t('ty') } };
}

type ItemOpts = {
  world: number;
  topics?: number[];
  audience?: 'kids' | 'all' | 'adults';
  kind?: 'quiz' | 'game' | 'article' | 'puzzle';
  status?: 'published' | 'draft';
  answer?: unknown;
  body?: unknown;
};

const QUIZ = { mechanic: 'multiple_choice', prompt: 'Which?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] };

// A published multiple-choice quiz (answer "b") unless told otherwise; `answer: null` stores no item_answers row.
export async function item(db: Db, o: ItemOpts): Promise<string> {
  const audience = o.audience ?? 'all';
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1, $2, $3, $4, 'S', $5::jsonb, $6, $7, '2026-10-01T00:00:00Z', 'test', 'computable', 'test') RETURNING id`,
    [o.world, o.kind ?? 'quiz', `it-${n}`, `Item ${n++}`, JSON.stringify(o.body ?? QUIZ), audience, o.status ?? 'published'],
  );
  const id = r.rows[0].id;
  for (const t of o.topics ?? []) await db.query('INSERT INTO item_topics (item_id, topic_id) VALUES ($1, $2)', [id, t]);
  if (o.answer !== null) {
    await db.query("INSERT INTO item_answers (item_id, answer, explanation) VALUES ($1, $2::jsonb, 'Because.')", [
      id,
      JSON.stringify(o.answer ?? 'b'),
    ]);
  }
  return id;
}

export async function adult(db: Db, dateOfBirth = '1990-05-05'): Promise<string> {
  const r = await signUp(db, { email: `play${n++}@example.test`, dateOfBirth }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return r.accountId;
}

export async function circleOf(
  db: Db,
  owner: string,
  o: { kind?: string; timeZone?: string; name?: string } = {},
): Promise<{ slug: string; id: string }> {
  const r = await createCircle(db, owner, { name: 'Home', kind: o.kind ?? 'family', yourName: o.name ?? 'Mum', timeZone: o.timeZone }, T0);
  if (r.status !== 'created') throw new Error(`create failed: ${r.status}`);
  const id = (await db.query<{ id: string }>('SELECT id FROM circles WHERE slug = $1', [r.slug])).rows[0].id;
  return { slug: r.slug, id };
}

export async function join(db: Db, slug: string, accountId: string, name = 'Bea'): Promise<void> {
  await db.query('INSERT INTO circle_members (circle_id, account_id, display_name) SELECT id, $2, $3 FROM circles WHERE slug = $1', [
    slug,
    accountId,
    name,
  ]);
}

// A child profile of `accountId`, added to the family circle by its adult.
export async function childIn(db: Db, accountId: string, slug: string, name = 'Mia'): Promise<string> {
  const p = await db.query<{ id: string }>(
    "INSERT INTO child_profiles (account_id, display_name, age_band) VALUES ($1, $2, '6-9') RETURNING id",
    [accountId, name],
  );
  const id = p.rows[0].id;
  const r = await addChildToCircle(db, accountId, slug, id, 'on', T0);
  if (r !== 'added') throw new Error(`child not added: ${r}`);
  return id;
}
