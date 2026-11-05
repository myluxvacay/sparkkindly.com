// The owner's side of social distribution (plan 5A): the /admin/social/ overview and the four actions, each run by
// lib/admin/actions.ts inside its audited transaction. Platform settings: switch, cap 0 to 10, time HH:MM up to 20:00
// UTC. Hand-pick: handPickTx (eligibility and cap hold). Retry: failed -> scheduled now, for one more attempt only.
// Cancel: from selected, copy_ready, scheduled, failed or flagged (never while posting). Credentials are reported as yes/no, never a value.
// No Next.js imports. Verified by tests/unit/social-admin.test.ts.
import type { Queryable } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { ADAPTERS, hasCredentials } from './adapters/meta';
import { handPickTx, type PickResult } from './select';
import { isPlatform, isVideoPlatform, moveDistribution, PLATFORMS, type DistStatus, type Platform } from './states';
import { tokenStatus } from './token-store';
import { hasVideoCredentials } from './video/poster';

const TIME = /^([01]\d|20):([0-5]\d)$/;

export type PlatformSettings = { platform: Platform; enabled: boolean; dailyCap: number; postTime: string };

// Parses the platform form; null when anything is out of range.
export function parsePlatformForm(f: URLSearchParams): PlatformSettings | null {
  const platform = f.get('platform') ?? '';
  const cap = f.get('daily_cap') ?? '';
  const time = (f.get('post_time') ?? '').trim();
  if (!isPlatform(platform) || !/^\d{1,2}$/.test(cap) || Number(cap) > 10) return null;
  const m = TIME.exec(time);
  if (!m || (m[1] === '20' && m[2] !== '00')) return null;
  return { platform, enabled: f.get('enabled') === 'true', dailyCap: Number(cap), postTime: time };
}

export async function savePlatform(tx: Queryable, s: PlatformSettings): Promise<void> {
  await tx.query('UPDATE social_platforms SET enabled = $2, daily_cap = $3, post_time_utc = $4, updated_at = now() WHERE platform = $1', [
    s.platform,
    s.enabled,
    s.dailyCap,
    s.postTime,
  ]);
}

export const pickItem = (tx: Queryable, itemId: string, platform: Platform, now: Date): Promise<PickResult> =>
  handPickTx(tx, itemId, platform, now);

const RETRY_ATTEMPTS_LEFT = 3; // the poster fails a row at 4 attempts, so one more try

export async function distributionStatus(tx: Queryable, id: number): Promise<DistStatus | null> {
  const r = await tx.query<{ status: DistStatus }>('SELECT status FROM distributions WHERE id = $1 FOR UPDATE', [id]);
  return r.rows[0]?.status ?? null;
}

export const retryDistribution = (tx: Queryable, id: number, now: Date) =>
  moveDistribution(tx, id, 'retry', { set: { attempts: RETRY_ATTEMPTS_LEFT, scheduled_for: now.toISOString(), last_error: null } });

// The owner checked the platform and the flagged post is there (5A review M1): it stays as posted, never retried.
export const keepDistribution = (tx: Queryable, id: number) =>
  moveDistribution(tx, id, 'keep', { set: { last_error: 'kept as posted by the owner' } });

export const cancelDistribution = (tx: Queryable, id: number) =>
  moveDistribution(tx, id, 'cancel', { set: { last_error: 'cancelled by the owner' } });

export type DistributionRow = {
  id: number; platform: Platform; day: string; status: DistStatus; skipReason: string | null; title: string; world: string;
  slug: string; link: string | null; postUrl: string | null; lastError: string | null; scheduledFor: Date | null;
  postedAt: Date | null; attempts: number;
};
export type Overview = {
  platforms: (PlatformSettings & { credentials: boolean; supported: boolean; reauth?: boolean })[];
  distributions: DistributionRow[];
  visits: { platform: Platform; title: string; world: string; slug: string; visits: number }[];
};

async function platforms(db: Queryable, env: EnvLike): Promise<Overview['platforms']> {
  const r = await db.query<{ platform: Platform; enabled: boolean; daily_cap: number; t: string }>(
    "SELECT platform, enabled, daily_cap, to_char(post_time_utc, 'HH24:MI') AS t FROM social_platforms",
  );
  const order = (p: Platform) => PLATFORMS.indexOf(p);
  return r.rows
    .sort((a, b) => order(a.platform) - order(b.platform))
    .map((p) => ({
      platform: p.platform,
      enabled: p.enabled,
      dailyCap: p.daily_cap,
      postTime: p.t,
      // TikTok and YouTube post video through the video queue (plan 5B); their tokens can need re-authorisation.
      supported: !!ADAPTERS[p.platform] || isVideoPlatform(p.platform),
      credentials: isVideoPlatform(p.platform) ? hasVideoCredentials(p.platform, env) : hasCredentials(p.platform, env),
      ...(isVideoPlatform(p.platform) && tokenStatus(p.platform, env) === 'reauth' ? { reauth: true } : {}),
    }));
}

async function distributions(db: Queryable, now: Date): Promise<DistributionRow[]> {
  const r = await db.query<Record<string, unknown>>(
    `SELECT d.id, d.platform, to_char(d.day, 'YYYY-MM-DD') AS day, d.status, d.skip_reason, i.title, w.slug AS world, i.slug,
            d.link, d.post_url, d.last_error, d.scheduled_for, d.posted_at, d.attempts
     FROM distributions d JOIN items i ON i.id = d.item_id JOIN worlds w ON w.id = i.world_id
     WHERE d.day > $1::date - 7 OR d.status IN ('failed', 'flagged', 'posting')
     ORDER BY d.day DESC, d.platform, d.status, d.id LIMIT 300`,
    [now.toISOString().slice(0, 10)],
  );
  return r.rows.map((x) => ({
    id: Number(x.id), platform: x.platform as Platform, day: x.day as string, status: x.status as DistStatus,
    skipReason: x.skip_reason as string | null, title: x.title as string, world: x.world as string, slug: x.slug as string,
    link: x.link as string | null, postUrl: x.post_url as string | null, lastError: x.last_error as string | null,
    scheduledFor: x.scheduled_for as Date | null, postedAt: x.posted_at as Date | null, attempts: x.attempts as number,
  }));
}

async function visits(db: Queryable, now: Date): Promise<Overview['visits']> {
  const r = await db.query<{ platform: Platform; title: string; world: string; slug: string; visits: number }>(
    `SELECT v.platform, i.title, w.slug AS world, i.slug, sum(v.visits)::int AS visits
     FROM social_visits v JOIN items i ON i.id = v.item_id JOIN worlds w ON w.id = i.world_id
     WHERE v.day > $1::date - 30 GROUP BY v.platform, i.id, i.title, w.slug, i.slug ORDER BY visits DESC LIMIT 50`,
    [now.toISOString().slice(0, 10)],
  );
  return r.rows;
}

export async function socialOverview(db: Queryable, now: Date, env: EnvLike): Promise<Overview> {
  return { platforms: await platforms(db, env), distributions: await distributions(db, now), visits: await visits(db, now) };
}
