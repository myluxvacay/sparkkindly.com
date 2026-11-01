import type { Queryable } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { allowList } from './sessions';

// The owner's morning email (spec, Project 1): what was published in the last day, what is waiting for approval,
// what failed and why, days of buffer per world, and alerts. Also rendered on /admin/digest/. Plain text only:
// titles are agent-written data. It never includes answers, explanations or quality-report internals.

export type Digest = {
  day: string;
  published: { title: string; world: string }[];
  waiting: { title: string; world: string; since: Date }[];
  heldByGates: { title: string; world: string; reason: string }[];
  failedJobs: { job: string; error: string; at: Date }[];
  buffer: { world: string; days: number }[];
  openReports: number;
  alerts: string[];
};

const DAY = 86_400_000;

export async function buildDigest(db: Queryable, now: Date): Promise<Digest> {
  const since = new Date(now.getTime() - DAY).toISOString();
  const at = now.toISOString();
  const published = await db.query<{ title: string; world: string }>(
    `SELECT i.title, w.slug AS world FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE i.status = 'published' AND i.published_at > $1::timestamptz AND i.published_at <= $2::timestamptz
     ORDER BY i.published_at`,
    [since, at],
  );
  const waiting = await db.query<{ title: string; world: string; since: Date }>(
    `SELECT i.title, w.slug AS world, i.created_at AS since FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE i.status = 'in_review' ORDER BY i.created_at`,
  );
  const held = await db.query<{ title: string; world: string; reason: string | null }>(
    `SELECT i.title, w.slug AS world, i.quality_report->>'decision' AS reason FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE i.status = 'draft' AND i.created_at > $1::timestamptz AND i.created_at <= $2::timestamptz ORDER BY i.created_at`,
    [since, at],
  );
  const failed = await db.query<{ job: string; error: string; at: Date }>(
    'SELECT job, error, at FROM failed_jobs WHERE at > $1::timestamptz AND at <= $2::timestamptz ORDER BY at',
    [since, at],
  );
  const buffer = await db.query<{ world: string; days: string }>(
    `SELECT w.slug AS world,
            count(DISTINCT date_trunc('day', i.publish_at)) FILTER (WHERE i.status = 'scheduled' AND i.publish_at > $1::timestamptz) AS days
     FROM worlds w LEFT JOIN items i ON i.world_id = w.id WHERE w.enabled GROUP BY w.slug, w.sort ORDER BY w.sort, w.slug`,
    [at],
  );
  const reports = await db.query<{ n: string }>("SELECT count(*) AS n FROM problem_reports WHERE status = 'open'");
  const agents = await db.query<{ n: string }>('SELECT count(*) AS n FROM agents WHERE last_run_at > $1::timestamptz', [
    new Date(now.getTime() - 3 * DAY).toISOString(),
  ]);

  const d: Digest = {
    day: at.slice(0, 10),
    published: published.rows,
    waiting: waiting.rows,
    heldByGates: held.rows.map((h) => ({ ...h, reason: h.reason ?? 'held' })),
    failedJobs: failed.rows,
    buffer: buffer.rows.map((b) => ({ world: b.world, days: Number(b.days) })),
    openReports: Number(reports.rows[0].n),
    alerts: [],
  };
  const lateKids = d.waiting.filter((w) => w.world === 'kids' && now.getTime() - new Date(w.since).getTime() > 2 * DAY);
  if (lateKids.length) d.alerts.push(`${lateKids.length} Kids item has waited more than 48 hours for approval.`);
  const thin = d.buffer.filter((b) => b.days < 1).map((b) => b.world);
  if (thin.length) d.alerts.push(`Less than one day of buffer: ${thin.join(', ')}.`);
  if (d.failedJobs.length) d.alerts.push(`${d.failedJobs.length} job failed in the last day.`);
  if (Number(agents.rows[0].n) === 0) d.alerts.push('No agent has run in 3 days.');
  const oldKeys = await db.query<{ n: string }>(
    'SELECT count(*) AS n FROM agents WHERE enabled AND COALESCE(key_rotated_at, created_at) < $1::timestamptz',
    [new Date(now.getTime() - 90 * DAY).toISOString()],
  );
  const stale = Number(oldKeys.rows[0].n);
  if (stale) d.alerts.push(`${stale} agent key is over 90 days old: rotate it in /admin/agents/.`);
  return d;
}

function section(title: string, lines: string[]): string {
  return `${title}\n${lines.length ? lines.map((l) => `- ${l}`).join('\n') : '- none'}\n`;
}

export function renderDigest(d: Digest): { subject: string; text: string } {
  const subject = `SparkKindly digest for ${d.day}: ${d.published.length} published, ${d.waiting.length} waiting, ${d.alerts.length} alerts`;
  const text = [
    section('Alerts', d.alerts),
    section('Published in the last 24 hours', d.published.map((p) => `${p.world}: ${p.title}`)),
    section('Waiting for approval', d.waiting.map((w) => `${w.world}: ${w.title} (since ${new Date(w.since).toISOString().slice(0, 16)}Z)`)),
    section('Held by the quality gates', d.heldByGates.map((h) => `${h.world}: ${h.title} (${h.reason})`)),
    section('Failed jobs', d.failedJobs.map((f) => `${f.job}: ${f.error}`)),
    section('Buffer (days of scheduled items ahead)', d.buffer.map((b) => `${b.world}: ${b.days}`)),
    `Open problem reports: ${d.openReports}\n`,
    'Open the admin area: https://sparkkindly.com/admin/\n',
  ].join('\n');
  return { subject, text };
}

type Claim =
  | { status: 'not_due' | 'already_sent' | 'no_recipients' }
  | { status: 'claimed'; day: string; to: string[] };

// Claims today's digest (one row in job_runs) once the digest hour has come. A claimed day is never claimed again, so
// a digest that keeps failing is recorded in failed_jobs (by the worker's runJob around deliverDigest) instead of being
// retried every minute. Building and sending happen after the claim, in deliverDigest.
export async function claimDigest(db: Queryable, now: Date, env: EnvLike): Promise<Claim> {
  const hour = Number(env.DIGEST_HOUR_UTC ?? 7);
  if (now.getUTCHours() < (Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : 7)) return { status: 'not_due' };
  const to = allowList(env);
  if (!to.length) return { status: 'no_recipients' };
  const day = now.toISOString().slice(0, 10);
  const r = await db.query("INSERT INTO job_runs (job, run_key) VALUES ('digest', $1) ON CONFLICT DO NOTHING RETURNING run_key", [day]);
  if (!r.rows.length) return { status: 'already_sent' };
  return { status: 'claimed', day, to };
}

// Builds the digest and sends it to each address that has not had today's copy, recording each delivery as job_runs
// ('digest', '<day>:<address>') once it succeeds. Safe to retry: after one recipient fails, a retry never sends the
// others a second copy. Throws if building or any send fails, so runJob retries and then records it in failed_jobs.
export async function deliverDigest(
  db: Queryable,
  now: Date,
  day: string,
  to: string[],
  send: (m: EmailMessage) => Promise<unknown>,
): Promise<void> {
  const { subject, text } = renderDigest(await buildDigest(db, now));
  const failures: string[] = [];
  for (const address of to) {
    const key = `${day}:${address}`;
    const done = await db.query("SELECT 1 FROM job_runs WHERE job = 'digest' AND run_key = $1", [key]);
    if (done.rows.length) continue;
    try {
      await send({ to: address, subject, text });
    } catch (err) {
      failures.push((err as Error).message);
      continue;
    }
    await db.query("INSERT INTO job_runs (job, run_key) VALUES ('digest', $1) ON CONFLICT DO NOTHING", [key]);
  }
  if (failures.length) throw new Error(`digest not delivered to ${failures.length} address(es): ${failures[0]}`);
}

export async function sendDigestIfDue(
  db: Queryable,
  now: Date,
  env: EnvLike,
  send: (m: EmailMessage) => Promise<unknown>,
): Promise<'sent' | 'not_due' | 'already_sent' | 'no_recipients'> {
  const claim = await claimDigest(db, now, env);
  if (claim.status !== 'claimed') return claim.status;
  await deliverDigest(db, now, claim.day, claim.to, send);
  return 'sent';
}
