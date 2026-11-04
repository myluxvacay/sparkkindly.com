import type { Queryable } from '@/lib/db';
import { PUBLIC_SELECT, toPublic, type PublicItem } from '@/lib/items/repo';
import type { Scope } from './scope';

type Row = Record<string, unknown>;
type Page = { limit: number; offset: number };

const MAX_LIMIT = 50;
const MAX_QUERY_CHARS = 100;

// What may be shown to anyone: published and due, in an enabled world, a kind the site renders (never a
// video_script), and an audience the scope allows, over `items i JOIN worlds w`. `now` and `audiences` name the query
// parameters holding the clock and the allowed audiences. Every read below, and the saved-answer reads in
// lib/accounts/responses.ts, start from this one predicate so no read can forget a rule.
export const visibleWhere = (now: string, audiences: string) =>
  `i.status = 'published' AND i.published_at <= ${now} AND w.enabled AND i.locale = 'en'
  AND i.kind IN ('article', 'quiz', 'game') AND i.audience = ANY(${audiences}::text[])`;
const VISIBLE = visibleWhere('$1', '$2');

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

// Items in a picked world or carrying a picked topic, published in [from, to), newest first (the /me dashboard).
// No picks match nothing.
export async function listByInterests(
  db: Queryable,
  scope: Scope,
  o: { worldIds: number[]; topicIds: number[]; from: Date; to: Date; limit: number },
): Promise<PublicItem[]> {
  if (o.worldIds.length + o.topicIds.length === 0) return [];
  const { limit } = clampPage({ limit: o.limit, offset: 0 });
  const r = await db.query<Row>(
    `${PUBLIC_SELECT} WHERE ${VISIBLE} AND i.published_at >= $5 AND i.published_at < $6
       AND (i.world_id = ANY($3::int[])
            OR EXISTS (SELECT 1 FROM item_topics it WHERE it.item_id = i.id AND it.topic_id = ANY($4::int[])))
     ORDER BY i.published_at DESC, i.id LIMIT $7`,
    [...base(scope), o.worldIds, o.topicIds, o.from, o.to, limit],
  );
  return r.rows.map(toPublic);
}

// The visible items among these ids (any order); an id the scope may not see is simply absent.
export async function listPublicByIds(db: Queryable, scope: Scope, ids: string[]): Promise<PublicItem[]> {
  if (ids.length === 0) return [];
  const r = await db.query<Row>(`${PUBLIC_SELECT} WHERE ${VISIBLE} AND i.id = ANY($3::uuid[])`, [...base(scope), ids]);
  return r.rows.map(toPublic);
}

export const listQuizzes = (db: Queryable, scope: Scope, page: Page) => listPublic(db, scope, { kind: 'quiz', ...page });

// Old /quiz/<id>/ links carry only a slug, so find the published quiz with that slug in any world (the newest if several).
export async function findQuizBySlug(db: Queryable, scope: Scope, slug: string): Promise<PublicItem | null> {
  const r = await db.query<Row>(
    `${PUBLIC_SELECT} WHERE ${VISIBLE} AND i.kind = 'quiz' AND i.slug = $3 ORDER BY i.published_at DESC LIMIT 1`,
    [...base(scope), slug],
  );
  return r.rows[0] ? toPublic(r.rows[0]) : null;
}

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

const SITEMAP_LIMIT = 5000;

// Everything the sitemap may list, under the same VISIBLE predicate as every other read: item locations with their
// last change, and the topics that have at least one visible item.
export async function sitemapRows(
  db: Queryable,
  scope: Scope,
): Promise<{ items: { world: string; slug: string; updatedAt: Date }[]; topics: string[] }> {
  const items = await db.query<{ world: string; slug: string; updated_at: Date }>(
    `SELECT w.slug AS world, i.slug, i.updated_at FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE ${VISIBLE} ORDER BY i.published_at DESC, i.id LIMIT ${SITEMAP_LIMIT}`,
    base(scope),
  );
  const topics = await db.query<{ slug: string }>(
    `SELECT DISTINCT t.slug FROM topics t JOIN item_topics it ON it.topic_id = t.id JOIN items i ON i.id = it.item_id
     JOIN worlds w ON w.id = i.world_id WHERE ${VISIBLE} ORDER BY t.slug`,
    base(scope),
  );
  return { items: items.rows.map((r) => ({ world: r.world, slug: r.slug, updatedAt: r.updated_at })), topics: topics.rows.map((r) => r.slug) };
}
