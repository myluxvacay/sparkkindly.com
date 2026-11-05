// The social poster (plan 5A), run by the worker every 5 minutes. It claims one due row at a time with a conditional
// UPDATE (scheduled -> posting, attempts + 1), so two workers never take the same row, and holds no transaction across
// the platform call. Before posting it re-reads the item (no longer eligible: cancelled) and the day's posts (cap
// reached: moved to the next day's time, attempt not counted). It posts exactly postText(stored caption, hashtags,
// link) with the stored image URL. Transient failures go back to scheduled 5 minutes later, up to 4 attempts in all, then
// failed; permanent failures fail at once; an ambiguous one (the platform may have posted) is flagged and never retried.
// Platforms without credentials are not claimed at all and are reported. A row left in `posting` for 30 minutes (a crash
// mid-post) is flagged by recoverStuck, never retried. Once the platform accepted a post, any later error (a database
// write, the re-check) flags the row, never defers or fails it (5A review H1). Every failed or flagged row writes one failed_jobs alert (the
// digest), with the status and code only. No Next.js imports. Verified by tests/unit/social-poster.test.ts.
import { socialEnabled } from '@/lib/config';
import type { Queryable } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { alert } from '@/lib/jobs/guards';
import { ADAPTERS, hasCredentials, SocialPostError, type PlatformAdapter } from './adapters/meta';
import { postText, scheduleTime } from './copy';
import { eligibleItem } from './eligibility';
import { moveDistribution, type Platform } from './states';

export type PosterDeps = {
  env: EnvLike;
  fetch: typeof fetch;
  adapters?: Partial<Record<Platform, PlatformAdapter>>;
  sleep?: (ms: number) => Promise<void>;
};
export type PosterResult = { posted: number; deferred: number; failed: number; cancelled: number; flagged: number; noCredentials: Platform[] };

const MAX_ATTEMPTS = 4; // the first try and 3 retries
const RETRY_MS = 5 * 60_000;
const STUCK_MS = 30 * 60_000;
const LATE_MS = 24 * 3_600_000;
const PER_RUN = 10;

type Claimed = {
  id: number; item_id: string; platform: Platform; caption: string; hashtags: string[]; link: string; image_url: string;
  attempts: number; daily_cap: number; post_time_utc: string;
};

export async function duePlatforms(db: Queryable, now: Date, platforms: Platform[]): Promise<Platform[]> {
  const r = await db.query<{ platform: Platform }>(
    `SELECT DISTINCT d.platform FROM distributions d JOIN social_platforms p ON p.platform = d.platform
     WHERE d.status = 'scheduled' AND d.scheduled_for <= $1 AND p.enabled AND d.platform = ANY($2::text[])`,
    [now.toISOString(), platforms],
  );
  return r.rows.map((x) => x.platform);
}

async function claim(db: Queryable, now: Date, platforms: Platform[]): Promise<Claimed | null> {
  const r = await db.query<Claimed>(
    `UPDATE distributions d SET status = 'posting', attempts = d.attempts + 1, version = d.version + 1, updated_at = $1
     FROM social_platforms p
     WHERE p.platform = d.platform AND d.id = (
       SELECT x.id FROM distributions x JOIN social_platforms xp ON xp.platform = x.platform
       WHERE x.status = 'scheduled' AND x.scheduled_for <= $1 AND xp.enabled AND x.platform = ANY($2::text[])
       ORDER BY x.scheduled_for, x.id LIMIT 1 FOR UPDATE OF x SKIP LOCKED)
       AND d.status = 'scheduled'
     RETURNING d.id, d.item_id, d.platform, d.caption, d.hashtags, d.link, d.image_url, d.attempts, p.daily_cap,
               p.post_time_utc::text AS post_time_utc`,
    [now.toISOString(), platforms],
  );
  return r.rows[0] ? { ...r.rows[0], id: Number(r.rows[0].id) } : null;
}

export const tomorrow = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

// Posts made on the platform during this UTC day (posted, or flagged after posting).
export async function postedToday(db: Queryable, platform: Platform, now: Date): Promise<number> {
  const end = tomorrow(now);
  const start = new Date(end.getTime() - 24 * 3_600_000);
  const r = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM distributions WHERE platform = $1 AND posted_at >= $2 AND posted_at < $3',
    [platform, start.toISOString(), end.toISOString()],
  );
  return r.rows[0].n;
}

export async function failRow(db: Queryable, d: { id: number; platform: Platform }, event: 'fail' | 'flag', message: string): Promise<void> {
  await moveDistribution(db, d.id, event, { set: { last_error: message } });
  const what = event === 'fail' ? 'failed' : 'flagged for the owner (it may have been posted)';
  await alert(db, 'social-post', `social post ${d.id} on ${d.platform} ${what}: ${message}`);
}

// A quota or rate limit (plan 5B) writes one failed_jobs line per platform and UTC day, however often it recurs.
async function limitAlert(db: Queryable, platform: Platform, now: Date, message: string): Promise<void> {
  const r = await db.query("INSERT INTO job_runs (job, run_key) VALUES ('social-limit', $1) ON CONFLICT DO NOTHING RETURNING run_key", [
    `${platform}:${now.toISOString().slice(0, 10)}`,
  ]);
  if (r.rows.length) await alert(db, 'social-post', `${platform} quota or rate limit reached (${message}): posts wait and retry later`);
}

// Exported for the video poster (plan 5B), which handles failures the same way.
export async function onError(db: Queryable, d: { id: number; platform: Platform; attempts: number }, err: unknown, now: Date, r: PosterResult): Promise<void> {
  const e = err instanceof SocialPostError ? err : new SocialPostError('transient', 'unexpected error');
  if (e.kind === 'ambiguous') {
    await failRow(db, d, 'flag', e.message);
    r.flagged++;
  } else if (e.kind === 'transient' && d.attempts < MAX_ATTEMPTS) {
    const wait = e.backoffMs ?? RETRY_MS;
    await moveDistribution(db, d.id, 'defer', { set: { last_error: e.message, scheduled_for: new Date(now.getTime() + wait).toISOString() } });
    if (e.backoffMs) await limitAlert(db, d.platform, now, e.message);
    r.deferred++;
  } else if (e.kind === 'credentials') {
    await moveDistribution(db, d.id, 'defer', { set: { attempts: d.attempts - 1, last_error: 'no credentials' } });
    r.deferred++;
  } else {
    await failRow(db, d, 'fail', e.message);
    r.failed++;
  }
}

// A database error in a check before the platform call (5A review L3): nothing was sent, so the row simply waits for
// the next run (attempt not counted), never flagged. Exported for the video poster.
export async function deferUnchecked(db: Queryable, d: { id: number; attempts: number }, now: Date, r: PosterResult): Promise<void> {
  const at = new Date(now.getTime() + RETRY_MS).toISOString();
  await moveDistribution(db, d.id, 'defer', { set: { attempts: d.attempts - 1, scheduled_for: at, last_error: 'database error before posting' } }).catch(() => undefined);
  r.deferred++;
}

// The checks before the platform call; true when the row may go (otherwise it has already been moved).
async function mayPost(db: Queryable, d: Claimed, now: Date, r: PosterResult): Promise<boolean> {
  try {
    if (!(await eligibleItem(db, d.item_id, now))) {
      await moveDistribution(db, d.id, 'cancel', { set: { last_error: 'item no longer eligible at post time' } });
      r.cancelled++;
      return false;
    }
    if ((await postedToday(db, d.platform, now)) >= d.daily_cap) {
      const next = scheduleTime(d.post_time_utc, tomorrow(now)).toISOString();
      await moveDistribution(db, d.id, 'defer', { set: { attempts: d.attempts - 1, scheduled_for: next } });
      r.deferred++;
      return false;
    }
    return true;
  } catch {
    await deferUnchecked(db, d, now, r);
    return false;
  }
}

async function postOne(db: Queryable, d: Claimed, now: Date, deps: PosterDeps, adapter: PlatformAdapter, r: PosterResult): Promise<void> {
  if (!(await mayPost(db, d, now, r))) return;
  const text = postText(d.platform, { caption: d.caption, hashtags: d.hashtags, link: d.link });
  let out: PostResult;
  try {
    out = await adapter.post({ text, imageUrl: d.image_url }, { fetch: deps.fetch, env: deps.env, sleep: deps.sleep });
  } catch (err) {
    await onError(db, d, err, now, r);
    return;
  }
  await recordPosted(db, d, out, now, r);
}

type PostResult = Awaited<ReturnType<PlatformAdapter['post']>>;

// After the platform accepted the post (5A review H1): nothing here may lead to a retry. A failing write flags the row;
// if even that fails the row stays `posting` and recoverStuck flags it after 30 minutes. Exported for the video poster.
export async function recordPosted(db: Queryable, d: { id: number; item_id: string; platform: Platform }, out: PostResult, now: Date, r: PosterResult, where?: Parameters<typeof eligibleItem>[3]): Promise<void> {
  try {
    const set = { posted_at: now.toISOString(), post_url: out.url, external_id: out.externalId };
    if (!(await moveDistribution(db, d.id, 'posted', { set: { ...set, last_error: null } }))) {
      // An unpublish flagged the row while the call was in flight (5A review L2): keep what the platform returned.
      await db.query("UPDATE distributions SET posted_at = $2, post_url = $3, external_id = $4 WHERE id = $1 AND status = 'flagged'", [d.id, set.posted_at, set.post_url, set.external_id]);
      r.flagged++;
      return;
    }
    r.posted++;
    // Unpublished while the call was in flight: the post exists, so the owner removes it by hand.
    if (!(await eligibleItem(db, d.item_id, now, where))) {
      await failRow(db, d, 'flag', 'item unpublished while posting: remove manually from the platform');
    }
  } catch {
    await failRow(db, d, 'flag', `posted as ${out.externalId} but not recorded: check the platform`).catch(() => undefined);
  }
}

export async function runPoster(db: Queryable, now: Date, deps: PosterDeps): Promise<PosterResult> {
  const r: PosterResult = { posted: 0, deferred: 0, failed: 0, cancelled: 0, flagged: 0, noCredentials: [] };
  if (!socialEnabled()) return r;
  const adapters = deps.adapters ?? ADAPTERS;
  const supported = (Object.keys(adapters) as Platform[]).filter((p) => adapters[p]);
  const ready = supported.filter((p) => hasCredentials(p, deps.env));
  r.noCredentials = await duePlatforms(db, now, supported.filter((p) => !ready.includes(p)));
  if (ready.length) r.cancelled += await cancelLate(db, now, ready);
  for (let i = 0; i < PER_RUN && ready.length; i++) {
    const d = await claim(db, now, ready);
    if (!d) break;
    await postOne(db, d, now, deps, adapters[d.platform]!, r);
  }
  return r;
}

// Text posts more than 24 hours past their time are stale (5A review L5): cancelled as late, never posted. (Video posts
// wait for an approved file and are not passed here.)
async function cancelLate(db: Queryable, now: Date, platforms: Platform[]): Promise<number> {
  const r = await db.query(
    `UPDATE distributions SET status = 'cancelled', version = version + 1, updated_at = $1,
       last_error = 'late: more than 24 hours past its time, not posted'
     WHERE status = 'scheduled' AND scheduled_for < $2 AND platform = ANY($3::text[]) RETURNING id`,
    [now.toISOString(), new Date(now.getTime() - LATE_MS).toISOString(), platforms],
  );
  return r.rows.length;
}

// Rows left in `posting` for 30 minutes: the worker stopped mid-post and the platform may have the post.
export async function recoverStuck(db: Queryable, now: Date): Promise<number> {
  const r = await db.query<{ id: string; platform: string }>(
    `UPDATE distributions SET status = 'flagged', version = version + 1, updated_at = $1,
       last_error = 'interrupted while posting: check the platform, then cancel it or keep it as posted'
     WHERE status = 'posting' AND updated_at < $2 RETURNING id, platform`,
    [now.toISOString(), new Date(now.getTime() - STUCK_MS).toISOString()],
  );
  for (const x of r.rows) await alert(db, 'social-post', `social post ${x.id} on ${x.platform} was interrupted while posting and is flagged`);
  return r.rows.length;
}
