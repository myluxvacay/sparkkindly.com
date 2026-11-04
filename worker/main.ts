// The SparkKindly worker: one tick per run. A systemd timer starts it once a minute as a oneshot service (systemd never
// overlaps two runs of one unit), from the live release's directory, so a deploy needs no worker restart.
// Each job goes through runJob: three tries with growing waits, then one failed_jobs row; the tick itself never throws.
// Built into the release as worker.mjs by `npm run worker:build`. Verified by: tests/unit/digest.test.ts and account-retention.test.ts (tick) and the
// manual run in docs/OPERATIONS.md.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from '@/lib/db';
import type { EmailMessage } from '@/lib/email';
import type { EnvLike } from '@/lib/env';
import { publishDue } from '@/lib/jobs/publish-due';
import { claimHeartbeat, deliverHeartbeat } from '@/lib/jobs/heartbeat';
import { runJob } from '@/lib/jobs/run-job';
import type { DbNow } from '@/lib/jobs/guards';
import { claimDigest, deliverDigest } from '@/lib/admin/digest';
import { linkBase } from '@/lib/admin/sessions';
import { claimAccountPurge, purgeAccountData } from '@/lib/accounts/retention';
import { claimConsentSweep, runConsentSweep } from '@/lib/accounts/consent-sweep';
import { claimInactivitySweep, runInactivitySweep } from '@/lib/accounts/inactivity';

type Send = (m: EmailMessage) => Promise<unknown>;
// `dbNow` replaces the database clock the account jobs compare with `now` (lib/jobs/guards.ts); for tests only.
type TickOpts = { delayMs?: number; dbNow?: DbNow };

export async function tick(db: Db, now: Date, env: EnvLike, send: Send, opts: TickOpts = {}): Promise<string[]> {
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
  await accountPurge(db, now, log, opts);
  await consentSweep(db, now, env, send, log, opts);
  await inactivitySweep(db, now, env, send, log, opts);
  return log;
}

// Once per UTC day: purge unconfirmed sign-ups and spent credentials (lib/accounts/retention.ts).
async function accountPurge(db: Db, now: Date, log: string[], { delayMs, dbNow }: TickOpts): Promise<void> {
  const claimed = await claimAccountPurge(db, now).catch((err: Error) => {
    log.push(`account purge: could not check (${err.message})`);
    return null;
  });
  if (claimed === false) log.push('account purge: done today');
  if (!claimed) return;
  await runJob(
    db,
    'account-purge',
    async () => {
      const r = await purgeAccountData(db, now, { dbNow });
      log.push(`account purge: ${r.accounts} account(s), ${r.tokens} token(s), ${r.sessions} session(s)`);
    },
    { delayMs },
  );
}

// Once per UTC day: parental-consent reminders, 30-day deletions and cleared parent addresses (lib/accounts/consent-sweep.ts).
async function consentSweep(db: Db, now: Date, env: EnvLike, send: Send, log: string[], { delayMs, dbNow }: TickOpts): Promise<void> {
  const claimed = await claimConsentSweep(db, now).catch((err: Error) => {
    log.push(`consent sweep: could not check (${err.message})`);
    return null;
  });
  if (claimed === false) log.push('consent sweep: done today');
  if (!claimed) return;
  await runJob(
    db,
    'consent-sweep',
    async () => {
      const r = await runConsentSweep(db, now, send, { base: linkBase(env) }, { dbNow });
      log.push(`consent sweep: ${r.reminded} reminded, ${r.deleted} deleted, ${r.cleared} cleared, ${r.failed} failed`);
    },
    { delayMs },
  );
}

// Once per UTC day: 24-month inactivity notices and deletions 30 days later (lib/accounts/inactivity.ts).
async function inactivitySweep(db: Db, now: Date, env: EnvLike, send: Send, log: string[], { delayMs, dbNow }: TickOpts): Promise<void> {
  const claimed = await claimInactivitySweep(db, now).catch((err: Error) => {
    log.push(`inactivity sweep: could not check (${err.message})`);
    return null;
  });
  if (claimed === false) log.push('inactivity sweep: done today');
  if (!claimed) return;
  await runJob(
    db,
    'inactivity-sweep',
    async () => {
      const r = await runInactivitySweep(db, now, send, { base: linkBase(env) }, { dbNow });
      log.push(`inactivity sweep: ${r.noticed} noticed, ${r.deleted} deleted, ${r.failed} failed`);
    },
    { delayMs },
  );
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
