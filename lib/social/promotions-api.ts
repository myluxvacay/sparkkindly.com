// The promotion agent's two routes (plan 5A) as plain functions of a Request, so they test without Next: the flag
// (404 when off), then agentRoute with the promoter role only (content, world, moderation and reviewer keys get 403;
// a promoter key is refused everywhere else by the same check), the shared per-agent limiter and a 16 KB body cap.
// The agent reads item text (only inside `data`) and sends caption and hashtags; the server checks them (copy.ts),
// re-checks the item's eligibility, builds the link and image URL itself and sets the schedule. The agent cannot post,
// pick items, change platform, time or caps. No Next.js imports. Verified by tests/unit/social-promotions-api.test.ts.
import { z } from 'zod';
import { agentRoute, readJson } from '@/lib/agents/http';
import type { ApiResult } from '@/lib/agents/api';
import { socialEnabled } from '@/lib/config';
import type { Db, Queryable } from '@/lib/db';
import { CAPTION_LIMIT, checkCopy, MAX_HASHTAGS, scheduleTime } from './copy';
import { eligibleItem, socialEligibleWhere } from './eligibility';
import { buildLink, siteBase } from './links';
import { moveDistribution, type Platform } from './states';

export type PromotionDeps = { db: Db; now: Date; site: string; limiter: (key: string) => boolean };

const MAX_COPY_BYTES = 16_384;
const QUEUE_SIZE = 5;
const EXCERPT_CHARS = 600;
const notFound = () => Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });

const copyBody = z.strictObject({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  caption: z.string().max(4000),
  hashtags: z.array(z.string().max(60)).max(20),
});

// Every string in the item body, in order, joined: the body never holds answers (they live in item_answers).
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}
const excerpt = (body: unknown) => strings(body).join(' ').replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);

type QueueRow = { id: string; version: number; platform: Platform; world: string; kind: string; title: string; summary: string; body: unknown };

async function promotionQueue(db: Queryable, now: Date) {
  const r = await db.query<QueueRow>(
    `SELECT d.id, d.version, d.platform, w.slug AS world, i.kind, i.title, i.summary, i.body
     FROM distributions d JOIN social_platforms p ON p.platform = d.platform
     JOIN items i ON i.id = d.item_id JOIN worlds w ON w.id = i.world_id
     WHERE d.status = 'selected' AND p.enabled AND ${socialEligibleWhere('$1')}
     ORDER BY d.id LIMIT ${QUEUE_SIZE}`,
    [now.toISOString()],
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    version: x.version,
    platform: x.platform,
    limits: { caption: CAPTION_LIMIT[x.platform], hashtags: MAX_HASHTAGS },
    world: x.world,
    kind: x.kind,
    data: { title: x.title, summary: x.summary, excerpt: excerpt(x.body) },
  }));
}

type DistRow = { item_id: string; platform: Platform; status: string; version: number; caption: string | null; hashtags: string[]; post_time_utc: string };

async function lockDistribution(tx: Queryable, id: number): Promise<DistRow | null> {
  const r = await tx.query<DistRow>(
    `SELECT d.item_id, d.platform, d.status, d.version, d.caption, d.hashtags, p.post_time_utc::text AS post_time_utc
     FROM distributions d JOIN social_platforms p ON p.platform = d.platform WHERE d.id = $1 FOR UPDATE OF d`,
    [id],
  );
  return r.rows[0] ?? null;
}

const sameCopy = (d: DistRow, c: { caption: string; hashtags: string[] }) =>
  d.caption === c.caption && JSON.stringify(d.hashtags) === JSON.stringify(c.hashtags);

export async function submitCopy(db: Db, raw: unknown, now: Date, site: string): Promise<ApiResult> {
  const parsed = copyBody.safeParse(raw);
  if (!parsed.success) return { status: 400, json: { error: 'invalid_copy', reason: 'shape' } };
  const { id, version, caption, hashtags } = parsed.data;
  return db.transaction(async (tx) => {
    const d = await lockDistribution(tx, id);
    if (!d) return { status: 404, json: { error: 'not_found' } };
    const check = checkCopy(d.platform, { caption, hashtags });
    if (!check.ok) return { status: 400, json: { error: 'invalid_copy', reason: check.reason } };
    if (d.status !== 'selected' || d.version !== version) {
      if ((d.status === 'scheduled' || d.status === 'copy_ready') && sameCopy(d, { caption, hashtags })) {
        return { status: 200, json: { status: d.status, replay: true } };
      }
      return { status: 409, json: { error: 'stale' } };
    }
    const item = await eligibleItem(tx, d.item_id, now);
    if (!item) {
      await moveDistribution(tx, id, 'cancel', { set: { last_error: 'item no longer eligible' } });
      return { status: 409, json: { error: 'ineligible' } };
    }
    const base = siteBase(site);
    await moveDistribution(tx, id, 'copy', {
      version,
      set: {
        caption,
        hashtags: JSON.stringify(hashtags),
        link: buildLink(base, item, d.platform),
        image_url: `${base}/api/template-image/${item.world}/${item.slug}/?format=social`,
      },
    });
    await moveDistribution(tx, id, 'schedule', { set: { scheduled_for: scheduleTime(d.post_time_utc, now).toISOString() } });
    return { status: 200, json: { status: 'scheduled' } };
  });
}

// GET /api/agent/promotions/: up to 5 selected entries waiting for copy.
export function promotionsQueueRequest(request: Request, d: PromotionDeps): Promise<Response> {
  if (!socialEnabled()) return Promise.resolve(notFound());
  return agentRoute(request, async () => ({ status: 200, json: { entries: await promotionQueue(d.db, d.now) } }), {
    db: d.db,
    limiter: d.limiter,
    role: 'promoter',
  });
}

// POST /api/agent/promotions/copy/: one entry's caption and hashtags, re-validated by the server.
export function copyRequest(request: Request, d: PromotionDeps): Promise<Response> {
  if (!socialEnabled()) return Promise.resolve(notFound());
  return agentRoute(
    request,
    async () => {
      const body = await readJson(request, MAX_COPY_BYTES);
      if (!body.ok) return { status: body.response.status, json: await body.response.json() };
      return submitCopy(d.db, body.value, d.now, d.site);
    },
    { db: d.db, limiter: d.limiter, role: 'promoter' },
  );
}
