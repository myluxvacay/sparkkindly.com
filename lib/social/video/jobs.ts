// The promoter's side of video jobs (plan 5B): the brief_pending jobs it is offered (item text only inside `data`, the
// brand assets built by the server) and the brief it sends back. A brief is accepted only for a brief_pending job at
// the given version whose item is still eligible (else the job and its distribution are cancelled); the same brief
// again is a replay, anything else 409. On acceptance the job moves to brief_ready and its distribution to copy_ready
// with the platform's caption and hashtags; nothing is scheduled until the owner approves an uploaded file.
// No Next.js imports. Verified by tests/unit/social-video-brief.test.ts.
import { z } from 'zod';
import type { ApiResult } from '@/lib/agents/api';
import type { Db, Queryable } from '@/lib/db';
import { MAX_HASHTAGS } from '../copy';
import { eligibleItem, videoEligibleWhere } from '../eligibility';
import { moveDistribution, type VideoPlatform } from '../states';
import { brandAssets, LIMITS, mainCaption, validateBrief, type Brief } from './brief';
import { moveVideoJob } from './states';

const QUEUE_SIZE = 5;
const SCRIPT_CHARS = 2000;

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

type QueueRow = { id: string; version: number; platform: VideoPlatform; world: string; color: string; kind: string; title: string; summary: string; body: unknown };

export async function videoQueue(db: Queryable, now: Date) {
  const r = await db.query<QueueRow>(
    `SELECT j.id, j.version, j.platform, w.slug AS world, w.color, i.kind, i.title, i.summary, i.body
     FROM video_jobs j JOIN social_platforms p ON p.platform = j.platform
     JOIN items i ON i.id = j.item_id JOIN worlds w ON w.id = i.world_id
     WHERE j.state = 'brief_pending' AND p.enabled AND ${videoEligibleWhere('$1')}
     ORDER BY j.id LIMIT ${QUEUE_SIZE}`,
    [now.toISOString()],
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    version: x.version,
    platform: x.platform,
    limits: { ...LIMITS, hashtags: MAX_HASHTAGS, minSeconds: 15, maxSeconds: 60 },
    world: x.world,
    kind: x.kind,
    assets: brandAssets(x.color ?? ''),
    data: { title: x.title, summary: x.summary, script: strings(x.body).join(' ').replace(/\s+/g, ' ').trim().slice(0, SCRIPT_CHARS) },
  }));
}

const idVersion = z.object({ id: z.number().int().positive(), version: z.number().int().positive() });

type JobRow = { item_id: string; platform: VideoPlatform; state: string; version: number; brief: (Brief & { assets: unknown }) | null; distribution_id: string; color: string };

async function lockJob(tx: Queryable, id: number): Promise<JobRow | null> {
  const r = await tx.query<JobRow>(
    `SELECT j.item_id, j.platform, j.state, j.version, j.brief, j.distribution_id, w.color
     FROM video_jobs j JOIN items i ON i.id = j.item_id JOIN worlds w ON w.id = i.world_id WHERE j.id = $1 FOR UPDATE OF j`,
    [id],
  );
  return r.rows[0] ?? null;
}

// JSON with object keys sorted at every level (jsonb does not keep key order).
const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
      : JSON.stringify(v);

function sameBrief(stored: JobRow['brief'], b: Brief): boolean {
  if (!stored) return false;
  return canon({ ...stored, assets: undefined }) === canon({ ...b, assets: undefined });
}

export async function submitBrief(db: Db, raw: unknown, now: Date): Promise<ApiResult> {
  const ids = idVersion.safeParse(raw);
  if (!ids.success) return { status: 400, json: { error: 'invalid_brief', field: 'shape', reason: 'shape' } };
  const { id, version, ...rest } = raw as Record<string, unknown>;
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, ids.data.id);
    if (!job) return { status: 404, json: { error: 'not_found' } };
    const check = validateBrief(rest, job.platform);
    if (!check.ok) return { status: 400, json: { error: 'invalid_brief', field: check.field, reason: check.reason } };
    if (job.state !== 'brief_pending' || job.version !== version) {
      if (job.state !== 'cancelled' && sameBrief(job.brief, check.brief)) return { status: 200, json: { status: job.state, replay: true } };
      return { status: 409, json: { error: 'stale' } };
    }
    const did = Number(job.distribution_id);
    if (!(await eligibleItem(tx, job.item_id, now, videoEligibleWhere))) {
      await moveVideoJob(tx, Number(id), 'cancel');
      await moveDistribution(tx, did, 'cancel', { set: { last_error: 'item no longer eligible' } });
      return { status: 409, json: { error: 'ineligible' } };
    }
    const brief = { ...check.brief, assets: brandAssets(job.color ?? '') };
    await moveVideoJob(tx, Number(id), 'brief', { version, set: { brief: JSON.stringify(brief) } });
    await moveDistribution(tx, did, 'copy', { set: { caption: mainCaption(check.brief), hashtags: JSON.stringify(check.brief.hashtags) } });
    return { status: 200, json: { status: 'brief_ready' } };
  });
}
