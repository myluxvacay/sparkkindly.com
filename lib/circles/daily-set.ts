// The circle daily set (plan 4C, spec Project 4 "Circle interests" and "Child-safe sets"). Each circle day (the calendar
// date in circles.time_zone) gets up to SET_SIZE playable items: published quizzes and games with a stored answer that
// the public reads would show. Order of preference: not shown to this circle in the previous RECENT_DAYS days, then
// tier (0: matches the chosen topics and worlds, or anything when none are chosen; 1: in a chosen world; 2: any world;
// tiers 1 and 2 are flagged bonus), then a hash of (circle, day, item). The set is made on first request under an
// advisory lock and then fixed. Every read re-filters it with visibleWhere and the circle's CURRENT audiences, so a
// child joining hides an `adults` item at once (and it scores nothing, lib/circles/scores.ts).
// Callers pass a circle id they resolved from the caller's own membership. No Next.js imports.
// Verified by tests/unit/circles-daily-set.test.ts.
import { createHash } from 'node:crypto';
import type { Db, Queryable } from '@/lib/db';
import { visibleWhere } from '@/lib/public/reads';
import type { Audience } from '@/lib/public/scope';
import { CHILD_AUDIENCES } from '@/lib/accounts/context';
import { isUuid } from '@/lib/accounts/pin';
import { circleHasChild } from './children';
import { isSlug } from './repo';
import { interestsOf } from './interests';

export const SET_SIZE = 5;
export const RECENT_DAYS = 14;
const ALL_AUDIENCES: readonly Audience[] = ['kids', 'all', 'adults'];

export type SetItem = { itemId: string; position: number; bonus: boolean; title: string; slug: string; worldSlug: string; kind: string };

// YYYY-MM-DD in the zone (en-CA formats dates that way).
export function circleDay(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const rank = (circleId: string, day: string, id: string) => createHash('sha256').update(`${circleId}:${day}:${id}`).digest('hex');

export function orderCandidates(circleId: string, day: string, ids: string[]): string[] {
  const keyed = ids.map((id) => ({ id, k: rank(circleId, day, id) }));
  return keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((x) => x.id);
}

// Audience is a safety filter: a circle holding any current child profile gets kids and all only.
export async function circleAudiences(q: Queryable, circleId: string): Promise<readonly Audience[]> {
  return (await circleHasChild(q, circleId)) ? CHILD_AUDIENCES : ALL_AUDIENCES;
}

// The playable condition shared by selection and every read: $1 clock, $2 audiences.
export const PLAYABLE = `${visibleWhere('$1', '$2')} AND i.kind IN ('quiz', 'game')
  AND EXISTS (SELECT 1 FROM item_answers a WHERE a.item_id = i.id)`;

// A set day on which a child profile was a member keeps its `adults` items out (and scoreless) after the child leaves;
// only later days get the full scope again (4C review M2, migration 020). Needs the aliases i (item) and s (set row).
export const CHILD_DAY_SAFE = `NOT (i.audience = 'adults'
  AND EXISTS (SELECT 1 FROM circle_child_days cd WHERE cd.circle_id = s.circle_id AND cd.day = s.day))`;

type Candidate = { id: string; tier: number; recent: boolean };

// ponytail: reads every playable id and sorts in JS; move ordering into SQL if the catalogue reaches tens of thousands.
async function candidates(tx: Queryable, circleId: string, day: string, now: Date, audiences: readonly Audience[]) {
  const { topicIds, worldIds } = await interestsOf(tx, circleId);
  const r = await tx.query<Candidate>(
    `SELECT i.id,
       CASE WHEN (cardinality($3::int[]) = 0
                  OR EXISTS (SELECT 1 FROM item_topics it WHERE it.item_id = i.id AND it.topic_id = ANY($3::int[])))
             AND (cardinality($4::int[]) = 0 OR i.world_id = ANY($4::int[])) THEN 0
            WHEN i.world_id = ANY($4::int[]) THEN 1 ELSE 2 END AS tier,
       EXISTS (SELECT 1 FROM circle_daily_sets s WHERE s.circle_id = $5 AND s.item_id = i.id
               AND s.day >= $6::date - ${RECENT_DAYS} AND s.day < $6::date) AS recent
     FROM items i JOIN worlds w ON w.id = i.world_id WHERE ${PLAYABLE}`,
    [now, [...audiences], topicIds, worldIds, circleId, day],
  );
  return r.rows;
}

function pick(circleId: string, day: string, list: Candidate[]): Candidate[] {
  const byId = new Map(list.map((c) => [c.id, c]));
  const ordered = orderCandidates(circleId, day, [...byId.keys()]).map((id) => byId.get(id)!);
  // Array sort is stable, so the hash order survives inside each (recent, tier) group.
  ordered.sort((a, b) => Number(a.recent) - Number(b.recent) || a.tier - b.tier);
  return ordered.slice(0, SET_SIZE);
}

async function createSet(db: Db, circleId: string, day: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`circle-set:${circleId}:${day}`]);
    const has = await tx.query('SELECT 1 FROM circle_daily_sets WHERE circle_id = $1 AND day = $2 LIMIT 1', [circleId, day]);
    if (has.rows.length > 0) return;
    const chosen = pick(circleId, day, await candidates(tx, circleId, day, now, await circleAudiences(tx, circleId)));
    for (const [i, c] of chosen.entries()) {
      await tx.query(
        `INSERT INTO circle_daily_sets (circle_id, day, position, item_id, bonus) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [circleId, day, i + 1, c.id, c.tier > 0],
      );
    }
  });
}

type SetRow = { item_id: string; position: number; bonus: boolean; title: string; slug: string; world: string; kind: string };

// The circle's set for a day as its current members may see it now.
export async function readSet(q: Queryable, circleId: string, day: string, now: Date): Promise<SetItem[]> {
  const r = await q.query<SetRow>(
    `SELECT s.item_id, s.position, s.bonus, i.title, i.slug, w.slug AS world, i.kind
     FROM circle_daily_sets s JOIN items i ON i.id = s.item_id JOIN worlds w ON w.id = i.world_id
     WHERE s.circle_id = $3 AND s.day = $4 AND ${PLAYABLE} AND ${CHILD_DAY_SAFE} ORDER BY s.position`,
    [now, [...(await circleAudiences(q, circleId))], circleId, day],
  );
  return r.rows.map((x) => ({
    itemId: x.item_id,
    position: x.position,
    bonus: x.bonus,
    title: x.title,
    slug: x.slug,
    worldSlug: x.world,
    kind: x.kind,
  }));
}

export async function getOrCreateDailySet(db: Db, circleId: string, now: Date): Promise<SetItem[]> {
  const c = await db.query<{ time_zone: string; status: string }>('SELECT time_zone, status FROM circles WHERE id = $1', [
    circleId,
  ]);
  if (!c.rows[0]) return [];
  const day = circleDay(c.rows[0].time_zone, now);
  const has = await db.query('SELECT 1 FROM circle_daily_sets WHERE circle_id = $1 AND day = $2 LIMIT 1', [circleId, day]);
  // A closed circle is read-only: it shows the sets it has and makes no new one.
  if (has.rows.length === 0 && c.rows[0].status === 'open') await createSet(db, circleId, day, now);
  return readSet(db, circleId, day, now);
}

export type ViewerCircle = { id: string; name: string; slug: string; timeZone: string; status: 'open' | 'closed' };

// The visible circle named by `slug` when the viewer (the account holder, profileId null, or one of the account's child
// profiles) is a current member of it; otherwise null. Both ids come from the server-side context; a profile id that is
// not the account's, or not in the circle, matches no member row.
export async function circleForViewer(
  q: Queryable,
  accountId: string,
  profileId: string | null,
  slug: string,
): Promise<ViewerCircle | null> {
  if (!isUuid(accountId) || (profileId !== null && !isUuid(profileId)) || !isSlug(slug)) return null;
  const r = await q.query<{ id: string; name: string; time_zone: string; status: 'open' | 'closed' }>(
    `SELECT c.id, c.name, c.time_zone, c.status FROM circles c JOIN circle_members m ON m.circle_id = c.id
     WHERE c.slug = $1 AND c.hidden_at IS NULL AND m.account_id = $2 AND m.profile_id IS NOT DISTINCT FROM $3::uuid
       AND m.left_at IS NULL`,
    [slug, accountId, profileId],
  );
  const c = r.rows[0];
  return c ? { id: c.id, name: c.name, slug, timeZone: c.time_zone, status: c.status } : null;
}
