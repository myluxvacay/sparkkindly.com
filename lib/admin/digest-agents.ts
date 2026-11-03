import type { Queryable } from '@/lib/db';

const DAY = 86_400_000;

// Digest alerts about the content agents (spec, Project 2: quality over quota, usage budget). Derived from run
// records and item timestamps, so no history table is needed. Quiet when there is nothing to report or no history.
export async function agentAlerts(db: Queryable, now: Date): Promise<string[]> {
  const out: string[] = [];
  const at = now.toISOString();
  const since = new Date(now.getTime() - DAY).toISOString();

  // A world the last day's runs covered that has no new item in a passing state: the run fell short there.
  const short = await db.query<{ world: string }>(
    `SELECT DISTINCT c.world FROM (SELECT unnest(worlds) AS world FROM agent_runs WHERE ended_at > $1::timestamptz AND ended_at <= $2::timestamptz) c
     WHERE NOT EXISTS (
       SELECT 1 FROM items i JOIN worlds w ON w.id = i.world_id
       WHERE w.slug = c.world AND i.created_at > $1::timestamptz AND i.status IN ('scheduled', 'in_review', 'published'))
     ORDER BY c.world`,
    [since, at],
  );
  for (const s of short.rows) out.push(`${s.world}: no new item passed review in the last day's runs. Nothing was padded; evergreen items fill the gap.`);

  const limited = await db.query<{ n: string }>(
    'SELECT count(*) AS n FROM agent_runs WHERE rate_limited AND ended_at > $1::timestamptz AND ended_at <= $2::timestamptz',
    [since, at],
  );
  const hits = Number(limited.rows[0].n);
  if (hits) out.push(`The Claude plan's limit was hit in ${hits} run${hits === 1 ? '' : 's'} in the last day.`);

  // Worlds under their buffer target on 3 or more of the last 7 days. An item counts as "ahead" on a day if it existed
  // then and was due after it. Only judged once the agents have 7 days of history, so a fresh start does not nag.
  const old = await db.query('SELECT 1 FROM agent_runs WHERE started_at <= $1::timestamptz LIMIT 1', [new Date(now.getTime() - 7 * DAY).toISOString()]);
  if (old.rows.length) {
    const missed = await db.query<{ slug: string; n: string }>(
      `SELECT w.slug, count(*) AS n FROM worlds w CROSS JOIN generate_series(1, 7) AS k
       WHERE w.enabled AND (
         SELECT count(DISTINCT date_trunc('day', i.publish_at)) FROM items i
         WHERE i.world_id = w.id AND i.status IN ('scheduled', 'published')
           AND i.created_at <= $1::timestamptz - k * interval '1 day' AND i.publish_at > $1::timestamptz - k * interval '1 day'
       ) < w.buffer_days
       GROUP BY w.slug, w.sort HAVING count(*) >= 3 ORDER BY w.sort, w.slug`,
      [at],
    );
    for (const m of missed.rows) {
      out.push(`${m.slug} missed its buffer target on ${m.n} of the last 7 days. Consider raising the Claude plan, or lowering the per-world item counts.`);
    }
  }
  return out;
}
