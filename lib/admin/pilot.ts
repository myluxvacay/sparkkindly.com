import type { Queryable } from '@/lib/db';

// Pilot measurement (spec 4a.2), computed from data the site already holds. Aggregates only: no email, id or name
// leaves this module. Activation, return and interest uptake are over verified accounts created in the window
// ("signed-in members"); anonymous visitors carry no identifier by design, so they are not measured.
export const PILOT_THRESHOLDS = { activation: 40, returning: 30, interestUptake: 60, qualityPer100: 2, hoursPerWeek: 2 } as const;

export type Metric = { numerator: number; denominator: number; percent: number | null; threshold: number; met: boolean | null };
export type PilotMetrics = {
  members: number;
  activation: Metric;
  returning: Metric;
  interestUptake: Metric;
  quality: Metric & { per100: number | null };
};

const round1 = (x: number) => Math.round(x * 10) / 10;

// A zero denominator is "no data yet", never a pass. `higherIsBetter` false means met when strictly under threshold.
export function metric(numerator: number, denominator: number, threshold: number, higherIsBetter = true): Metric {
  if (denominator === 0) return { numerator, denominator, percent: null, threshold, met: null };
  const percent = round1((numerator / denominator) * 100);
  return { numerator, denominator, percent, threshold, met: higherIsBetter ? percent >= threshold : percent < threshold };
}

const MEMBER_SQL = `
WITH m AS (
  SELECT id, created_at FROM accounts
  WHERE verified_at IS NOT NULL AND created_at <= $1::timestamptz AND created_at > $1::timestamptz - make_interval(days => $2::int)
), first_answer AS (
  SELECT m.id, min(r.answered_at) AS at FROM m
  JOIN item_responses r ON r.account_id = m.id AND r.answered_at >= m.created_at AND r.answered_at <= m.created_at + interval '7 days'
  GROUP BY m.id
)
SELECT
  (SELECT count(*) FROM m)::int AS members,
  (SELECT count(*) FROM first_answer)::int AS activated,
  (SELECT count(*) FROM first_answer WHERE at <= $1::timestamptz - interval '7 days')::int AS return_den,
  (SELECT count(*) FROM first_answer f WHERE f.at <= $1::timestamptz - interval '7 days' AND EXISTS (
     SELECT 1 FROM item_responses r WHERE r.account_id = f.id
       AND r.answered_at <= f.at + interval '7 days'
       AND (r.answered_at AT TIME ZONE 'UTC')::date > (f.at AT TIME ZONE 'UTC')::date))::int AS returned,
  (SELECT count(*) FROM m WHERE EXISTS (
     SELECT 1 FROM profile_interests i WHERE i.account_id = m.id AND i.profile_id IS NULL))::int AS interested`;

const QUALITY_SQL = `
SELECT
  (SELECT count(*) FROM items WHERE published_at <= $1::timestamptz AND published_at > $1::timestamptz - make_interval(days => $2::int))::int AS published,
  (SELECT count(*) FROM audit_log a WHERE a.action IN ('item.unpublish', 'item.edit')
     AND a.at <= $1::timestamptz AND a.at > $1::timestamptz - make_interval(days => $2::int)
     AND a.target ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND EXISTS (SELECT 1 FROM items i WHERE i.id = CASE WHEN a.target ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN a.target::uuid END
                 AND i.published_at IS NOT NULL))::int AS corrections`;

export async function pilotMetrics(db: Queryable, now: Date, days = 21): Promise<PilotMetrics> {
  const params = [now.toISOString(), days];
  const m = (await db.query<Record<string, number>>(MEMBER_SQL, params)).rows[0];
  const q = (await db.query<Record<string, number>>(QUALITY_SQL, params)).rows[0];
  const quality = metric(q.corrections, q.published, PILOT_THRESHOLDS.qualityPer100, false);
  return {
    members: m.members,
    activation: metric(m.activated, m.members, PILOT_THRESHOLDS.activation),
    returning: metric(m.returned, m.return_den, PILOT_THRESHOLDS.returning),
    interestUptake: metric(m.interested, m.members, PILOT_THRESHOLDS.interestUptake),
    quality: { ...quality, per100: quality.percent },
  };
}
