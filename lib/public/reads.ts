import type { Queryable } from '@/lib/db';
import { PUBLIC_SELECT, toPublic, type PublicItem } from '@/lib/items/repo';
import type { Scope } from './scope';

type Row = Record<string, unknown>;
type Page = { limit: number; offset: number };

const MAX_LIMIT = 50;
const MAX_QUERY_CHARS = 100;

// What may be shown to anyone: published and due, in an enabled world, a kind the site renders (never a
// video_script), and an audience the scope allows. $1 is the clock, $2 the allowed audiences. Every read below
// starts from this one predicate so no read can forget a rule.
const VISIBLE = `i.status = 'published' AND i.published_at <= $1 AND w.enabled AND i.locale = 'en'
  AND i.kind IN ('article', 'quiz', 'game') AND i.audience = ANY($2::text[])`;

const base = (scope: Scope): unknown[] => [scope.now, [...scope.audiences]];
const whole = (n: number, fallback: number) => (Number.isFinite(n) ? Math.floor(n) : fallback);
const clampPage = (p: Page): Page => ({
  limit: Math.min(MAX_LIMIT, Math.max(1, whole(p.limit, 12))),
  offset: Math.max(0, whole(p.offset, 0)),
});

export async function getPublicItem(db: Queryable, scope: Scope, world: string, slug: string): Promise<PublicItem | null> {
  const r = await db.query<Row>(`${PUBLIC_SELECT} WHERE ${VISIBLE} AND w.slug = $3 AND i.slug = $4`, [...base(scope), world, slug]);
  return r.rows[0] ? toPublic(r.rows[0]) : null;
}

export async function listPublic(
  db: Queryable,
  scope: Scope,
  o: { world?: string; topic?: string; kind?: 'article' | 'quiz' | 'game' } & Page,
): Promise<PublicItem[]> {
  const params = base(scope);
  let where = VISIBLE;
  if (o.world) where += ` AND w.slug = $${params.push(o.world)}`;
  if (o.kind) where += ` AND i.kind = $${params.push(o.kind)}`;
  if (o.topic) {
    where += ` AND EXISTS (SELECT 1 FROM item_topics it JOIN topics t ON t.id = it.topic_id
                           WHERE it.item_id = i.id AND t.slug = $${params.push(o.topic)})`;
  }
  const { limit, offset } = clampPage(o);
  const r = await db.query<Row>(
    `${PUBLIC_SELECT} WHERE ${where} ORDER BY i.published_at DESC, i.id LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params,
  );
  return r.rows.map(toPublic);
}

export const listQuizzes = (db: Queryable, scope: Scope, page: Page) => listPublic(db, scope, { kind: 'quiz', ...page });

export async function latestQuiz(db: Queryable, scope: Scope): Promise<PublicItem | null> {
  return (await listQuizzes(db, scope, { limit: 1, offset: 0 }))[0] ?? null;
}

// Title and summary only (ruling): the WHERE uses the expression the items_search index was built on, so the index is
// used; the ORDER BY weights the title above the summary. websearch_to_tsquery accepts any text without erroring.
export async function searchPublic(db: Queryable, scope: Scope, q: string, page: Page): Promise<PublicItem[]> {
  const text = q.trim().slice(0, MAX_QUERY_CHARS);
  if (!text) return [];
  const params = [...base(scope), text];
  const { limit, offset } = clampPage(page);
  const r = await db.query<Row>(
    `${PUBLIC_SELECT}
     WHERE ${VISIBLE} AND to_tsvector('english', i.title || ' ' || i.summary) @@ websearch_to_tsquery('english', $3)
     ORDER BY ts_rank(setweight(to_tsvector('english', i.title), 'A') || setweight(to_tsvector('english', i.summary), 'B'),
                      websearch_to_tsquery('english', $3)) DESC,
              i.published_at DESC, i.id
     LIMIT $4 OFFSET $5`,
    [...params, limit, offset],
  );
  return r.rows.map(toPublic);
}
