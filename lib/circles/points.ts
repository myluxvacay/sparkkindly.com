// The owner-tuned points for a correct circle set answer (plan 4C): site_settings 'points_correct', 0 to 100, default 10.
// Written only by the audited admin action 'scoring.set_points' (lib/admin/actions.ts). Kept apart from scores.ts so
// /admin can show the value without importing the scoreboards. Verified by tests/unit/circles-scores.test.ts.
import type { Queryable } from '@/lib/db';

export const DEFAULT_POINTS = 10;

export async function pointsCorrect(q: Queryable): Promise<number> {
  const r = await q.query<{ value: string }>("SELECT value FROM site_settings WHERE key = 'points_correct'");
  const v = Number(r.rows[0]?.value);
  return Number.isInteger(v) && v >= 0 && v <= 100 ? v : DEFAULT_POINTS;
}
