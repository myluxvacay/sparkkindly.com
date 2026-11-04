import { z } from 'zod';
import type { Queryable } from '@/lib/db';
import type { ApiResult } from './api';
import type { Agent } from './auth';

const count = z.number().int().min(0).max(1000);
const runSchema = z.object({
  worlds: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1).max(20),
  itemsSubmitted: count,
  itemsScheduled: count,
  itemsInReview: count,
  itemsRejected: count,
  rateLimited: z.boolean(),
  note: z.string().max(300).optional(),
});

const fail = (status: number, error: string, message?: string): ApiResult => ({ status, json: { error, ...(message ? { message } : {}) } });

// The master agent reports one run: counts and a short note. A world agent's key is refused, because a run covers
// several worlds. The server stamps the time: a headless agent has no clock (it guessed), and the heartbeat reads this
// time, so it is never taken from the caller. started_at and ended_at are both the moment the run was recorded.
export async function recordRun(db: Queryable, agent: Agent, input: unknown, now: Date = new Date()): Promise<ApiResult> {
  if (agent.worldSlug) return fail(403, 'master_only', 'Only the master agent records runs.');
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) return fail(400, 'invalid_run', parsed.error.issues[0]?.message);
  const run = parsed.data;

  const known = await db.query<{ slug: string }>('SELECT slug FROM worlds WHERE slug = ANY($1::text[])', [run.worlds]);
  if (known.rows.length !== new Set(run.worlds).size) return fail(400, 'unknown_world');

  await db.query(
    `INSERT INTO agent_runs (agent_id, worlds, started_at, ended_at, items_submitted, items_scheduled, items_in_review, items_rejected, rate_limited, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [agent.id, run.worlds, now.toISOString(), now.toISOString(), run.itemsSubmitted, run.itemsScheduled, run.itemsInReview, run.itemsRejected, run.rateLimited, run.note ?? null],
  );
  return { status: 200, json: { ok: true } };
}

export async function latestRun(db: Queryable): Promise<{ endedAt: Date } | null> {
  const r = await db.query<{ ended_at: Date }>('SELECT ended_at FROM agent_runs ORDER BY ended_at DESC LIMIT 1');
  return r.rows[0] ? { endedAt: new Date(r.rows[0].ended_at) } : null;
}
