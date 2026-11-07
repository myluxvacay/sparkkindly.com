import type { Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { allowList } from '@/lib/admin/sessions';
import { latestRun } from '@/lib/agents/runs';

export const HEARTBEAT_LIMIT_HOURS = 36;

type Claim = { status: 'ok' | 'quiet' } | { status: 'claimed'; day: string; to: string[]; lastRunAt: Date };

// The master agent reports each finished run (lib/agents/runs.ts). If the last one ended more than 36 hours ago, the
// owner is told, once per UTC day. Quiet (and nothing claimed) when no master agent is enabled, when no run has ever been
// recorded (a fresh install must not alarm), or when nobody is on the allow-list. Claiming happens here, sending in
// deliverHeartbeat, so runJob can retry a failed send without re-alerting.
export async function claimHeartbeat(db: Queryable, now: Date, env: EnvLike): Promise<Claim> {
  const master = await db.query("SELECT 1 FROM agents WHERE role = 'content' AND world_id IS NULL AND enabled LIMIT 1");
  if (!master.rows.length) return { status: 'quiet' };
  const last = await latestRun(db);
  if (!last) return { status: 'quiet' };
  if (now.getTime() - last.endedAt.getTime() <= HEARTBEAT_LIMIT_HOURS * 3_600_000) return { status: 'ok' };
  const to = allowList(env);
  if (!to.length) return { status: 'quiet' };
  const day = now.toISOString().slice(0, 10);
  const claimed = await db.query("INSERT INTO job_runs (job, run_key) VALUES ('heartbeat', $1) ON CONFLICT DO NOTHING RETURNING run_key", [day]);
  return claimed.rows.length ? { status: 'claimed', day, to, lastRunAt: last.endedAt } : { status: 'quiet' };
}

// Sends the alert to each address that has not had today's copy, recording each delivery. Throws if any send fails.
export async function deliverHeartbeat(
  db: Queryable,
  now: Date,
  day: string,
  to: string[],
  lastRunAt: Date,
  send: (m: EmailMessage) => Promise<unknown>,
): Promise<void> {
  const hours = Math.floor((now.getTime() - lastRunAt.getTime()) / 3_600_000);
  const subject = 'SparkKindly: the content agents have gone quiet';
  const text = [
    `The content agents have not reported a finished run for ${hours} hours (the last one ended ${lastRunAt.toISOString()}).`,
    'The scheduled task on the owner machine may be disabled, the machine may be off or signed out, or Claude Code may need attention.',
    'The content buffer covers a few days; after that the site shows fewer new items. See "Content agents" in docs/OPERATIONS.md.',
  ].join('\n\n');
  const failures: string[] = [];
  for (const address of to) {
    const key = `${day}:${address}`;
    if ((await db.query("SELECT 1 FROM job_runs WHERE job = 'heartbeat' AND run_key = $1", [key])).rows.length) continue;
    try {
      await send({ to: address, subject, text });
    } catch (err) {
      failures.push((err as Error).message);
      continue;
    }
    await db.query("INSERT INTO job_runs (job, run_key) VALUES ('heartbeat', $1) ON CONFLICT DO NOTHING", [key]);
  }
  if (failures.length) throw new Error(`heartbeat alert not delivered to ${failures.length} address(es): ${failures[0]}`);
}
