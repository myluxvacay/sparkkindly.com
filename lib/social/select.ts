// The daily social selection (plan 5A, spec Project 5 Part A): per enabled platform, eligible items published in the
// last 3 days with no distribution for that platform yet, ordered by orderCandidates and cut at the day's remaining cap;
// every other candidate gets a skipped row with a fixed reason. Runs at most once per platform and UTC day (claimed in
// job_runs inside the same transaction), so a rerun or a second worker changes nothing. The owner's hand-pick bypasses
// the rotation but never eligibility or the cap. No Next.js imports.
// Verified by tests/unit/social-rules.test.ts and social-select.test.ts.
import { socialEnabled } from '@/lib/config';
import type { Db, Queryable } from '@/lib/db';
import { eligibleItem, socialEligibleWhere } from './eligibility';
import { isPlatform, type Platform } from './states';

export type Candidate = { itemId: string; worldSlug: string; kind: string; topicScore: number; publishedAt: Date };
export type SkipReason = 'cap_reached' | 'world_rotation' | 'not_playable' | 'lower_topic_popularity';

const PLAYABLE = new Set(['quiz', 'game']);
const playable = (c: Candidate) => (PLAYABLE.has(c.kind) ? 1 : 0);

// Within a world: playable first, then the more popular topic, then newest (item id last, for a stable order).
function compareInWorld(a: Candidate, b: Candidate): number {
  return (
    playable(b) - playable(a) ||
    b.topicScore - a.topicScore ||
    b.publishedAt.getTime() - a.publishedAt.getTime() ||
    a.itemId.localeCompare(b.itemId)
  );
}

// Worlds take turns, the one with the oldest last post on the platform first (never posted counts as oldest, ties by
// slug); each turn takes that world's best remaining candidate.
export function orderCandidates(candidates: Candidate[], lastPostByWorld: Record<string, Date | null | undefined>): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) groups.set(c.worldSlug, [...(groups.get(c.worldSlug) ?? []), c]);
  const last = (w: string) => lastPostByWorld[w]?.getTime() ?? -Infinity;
  const worlds = [...groups.keys()].sort((a, b) => last(a) - last(b) || a.localeCompare(b));
  const queues = worlds.map((w) => [...groups.get(w)!].sort(compareInWorld));
  const out: Candidate[] = [];
  for (let round = 0; out.length < candidates.length; round++) {
    for (const q of queues) if (q[round]) out.push(q[round]);
  }
  return out;
}

// Why a candidate was not picked, against the one its world preferred over it.
export function skipReason(c: Candidate, ordered: Candidate[], cap: number): SkipReason | null {
  const index = ordered.indexOf(c);
  if (index >= 0 && index < cap) return null;
  if (cap <= 0) return 'cap_reached';
  const sameWorld = ordered.filter((x) => x.worldSlug === c.worldSlug).sort(compareInWorld);
  const better = sameWorld[sameWorld.indexOf(c) - 1];
  if (!better) return 'world_rotation';
  if (playable(better) > playable(c)) return 'not_playable';
  if (better.topicScore > c.topicScore) return 'lower_topic_popularity';
  return 'cap_reached';
}

type PlatformRow = { enabled: boolean; daily_cap: number };

async function platformRow(db: Queryable, platform: Platform, lock = false): Promise<PlatformRow | null> {
  const r = await db.query<PlatformRow>(
    `SELECT enabled, daily_cap FROM social_platforms WHERE platform = $1${lock ? ' FOR UPDATE' : ''}`,
    [platform],
  );
  return r.rows[0] ?? null;
}

// The day's rows that count against the cap: everything picked and not cancelled, skipped or failed.
export async function usedToday(db: Queryable, platform: Platform, day: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM distributions
     WHERE platform = $1 AND day = $2 AND status IN ('selected', 'copy_ready', 'scheduled', 'posting', 'posted', 'flagged')`,
    [platform, day],
  );
  return r.rows[0].n;
}

async function candidates(db: Queryable, platform: Platform, now: Date): Promise<Candidate[]> {
  const r = await db.query<{ id: string; world: string; kind: string; score: number; published_at: Date }>(
    `SELECT i.id, w.slug AS world, i.kind, i.published_at,
            (SELECT count(*)::int FROM item_responses ir JOIN item_topics rt ON rt.item_id = ir.item_id
             WHERE ir.answered_at > $2::timestamptz - interval '14 days'
               AND rt.topic_id IN (SELECT topic_id FROM item_topics WHERE item_id = i.id)) AS score
     FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE ${socialEligibleWhere('$2')} AND i.published_at > $2::timestamptz - interval '3 days'
       AND NOT EXISTS (SELECT 1 FROM distributions d WHERE d.item_id = i.id AND d.platform = $1)`,
    [platform, now.toISOString()],
  );
  return r.rows.map((x) => ({
    itemId: x.id,
    worldSlug: x.world,
    kind: x.kind,
    topicScore: x.score,
    publishedAt: new Date(x.published_at),
  }));
}

async function lastPosts(db: Queryable, platform: Platform): Promise<Record<string, Date>> {
  const r = await db.query<{ slug: string; at: Date }>(
    `SELECT w.slug, max(d.posted_at) AS at FROM distributions d
     JOIN items i ON i.id = d.item_id JOIN worlds w ON w.id = i.world_id
     WHERE d.platform = $1 AND d.posted_at IS NOT NULL GROUP BY w.slug`,
    [platform],
  );
  return Object.fromEntries(r.rows.map((x) => [x.slug, new Date(x.at)]));
}

async function claimDay(db: Queryable, platform: Platform, day: string): Promise<boolean> {
  const r = await db.query(
    "INSERT INTO job_runs (job, run_key) VALUES ('social-select', $1) ON CONFLICT DO NOTHING RETURNING run_key",
    [`${platform}:${day}`],
  );
  return r.rows.length === 1;
}

export async function selectForDay(db: Db, platform: Platform, day: string, now: Date): Promise<{ selected: number; skipped: number }> {
  const none = { selected: 0, skipped: 0 };
  if (!socialEnabled() || !isPlatform(platform)) return none;
  return db.transaction(async (tx) => {
    const p = await platformRow(tx, platform, true);
    if (!p?.enabled || !(await claimDay(tx, platform, day))) return none;
    const cap = Math.max(0, p.daily_cap - (await usedToday(tx, platform, day)));
    const ordered = orderCandidates(await candidates(tx, platform, now), await lastPosts(tx, platform));
    for (const c of ordered) {
      const reason = skipReason(c, ordered, cap);
      await tx.query(
        `INSERT INTO distributions (item_id, platform, day, status, skip_reason) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (item_id, platform) DO NOTHING`,
        [c.itemId, platform, day, reason ? 'skipped' : 'selected', reason],
      );
    }
    const selected = Math.min(cap, ordered.length);
    return { selected, skipped: ordered.length - selected };
  });
}

export type PickResult = { ok: true } | { ok: false; reason: 'platform' | 'ineligible' | 'cap' | 'exists' };

// The owner's pick of one item for one platform today (UTC). Any publish date; the eligibility rule and the cap hold.
export async function handPick(db: Db, itemId: string, platform: Platform, now: Date): Promise<PickResult> {
  if (!socialEnabled() || !isPlatform(platform)) return { ok: false, reason: 'platform' };
  return db.transaction(async (tx) => {
    const p = await platformRow(tx, platform, true);
    if (!p?.enabled) return { ok: false, reason: 'platform' };
    if (!(await eligibleItem(tx, itemId, now))) return { ok: false, reason: 'ineligible' };
    const day = now.toISOString().slice(0, 10);
    const existing = await tx.query<{ status: string }>('SELECT status FROM distributions WHERE item_id = $1 AND platform = $2', [itemId, platform]);
    const status = existing.rows[0]?.status;
    if (status && status !== 'skipped' && status !== 'cancelled') return { ok: false, reason: 'exists' };
    if ((await usedToday(tx, platform, day)) >= p.daily_cap) return { ok: false, reason: 'cap' };
    const r = await tx.query(
      `INSERT INTO distributions (item_id, platform, day, status) VALUES ($1, $2, $3, 'selected')
       ON CONFLICT (item_id, platform) DO UPDATE
         SET status = 'selected', skip_reason = NULL, day = EXCLUDED.day, version = distributions.version + 1, updated_at = now()
         WHERE distributions.status IN ('skipped', 'cancelled')
       RETURNING id`,
      [itemId, platform, day],
    );
    return r.rows.length ? { ok: true } : { ok: false, reason: 'exists' };
  });
}
