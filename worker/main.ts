// The SparkKindly worker: one tick per run. A systemd timer starts it once a minute as a oneshot service (systemd never
// overlaps two runs of one unit), from the live release's directory, so a deploy needs no worker restart.
// Each job goes through runJob: three tries with growing waits, then one failed_jobs row; the tick itself never throws.
// Built into the release as worker.mjs by `npm run worker:build`. Verified by: tests/unit/digest.test.ts (tick) and the
// manual run in docs/OPERATIONS.md.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { publishDue } from '@/lib/jobs/publish-due';
import { claimHeartbeat, deliverHeartbeat } from '@/lib/jobs/heartbeat';
import { runJob } from '@/lib/jobs/run-job';
import { claimDigest, deliverDigest } from '@/lib/admin/digest';
import { linkBase } from '@/lib/admin/sessions';

type Send = (m: EmailMessage) => Promise<unknown>;

export async function tick(db: Db, now: Date, env: EnvLike, send: Send, opts: { delayMs?: number } = {}): Promise<string[]> {
  const log: string[] = [];
  await runJob(
    db,
    'publish-due',
    async () => {
      const r = await publishDue(db, now);
      log.push(`published ${r.published.length}, held ${r.held.length}, failed ${r.failed.length}`);
      if (r.failed.length) throw new Error(`${r.failed.length} item(s) could not be published: ${r.failed.join(', ')}`);
    },
    { delayMs: opts.delayMs },
  );
  const claim = await claimDigest(db, now, env).catch((err: Error) => {
    log.push(`digest: could not check (${err.message})`);
    return null;
  });
  if (claim?.status === 'claimed') {
    await runJob(db, 'digest', () => deliverDigest(db, now, claim.day, claim.to, send, `${linkBase(env)}/admin/`), { delayMs: opts.delayMs });
    log.push(`digest: attempted for ${claim.to.length} address(es)`);
  } else if (claim) {
    log.push(`digest: ${claim.status}`);
  }
  const beat = await claimHeartbeat(db, now, env).catch((err: Error) => {
    log.push(`heartbeat: could not check (${err.message})`);
    return null;
  });
  if (beat?.status === 'claimed') {
    await runJob(db, 'heartbeat', () => deliverHeartbeat(db, now, beat.day, beat.to, beat.lastRunAt, send), { delayMs: opts.delayMs });
    log.push(`heartbeat: attempted for ${beat.to.length} address(es)`);
  } else if (beat) {
    log.push(`heartbeat: ${beat.status}`);
  }
  return log;
}

async function main() {
  const { getDb, getPool } = await import('@/lib/db');
  const { sendEmail } = await import('@/lib/email');
  try {
    const log = await tick(getDb(), new Date(), process.env, (m) => sendEmail(m));
    console.log(`worker tick: ${log.join('; ')}`);
  } finally {
    await getPool().end();
  }
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  main().catch((err) => {
    console.error('worker tick failed:', (err as Error).message);
    process.exitCode = 1;
  });
}
