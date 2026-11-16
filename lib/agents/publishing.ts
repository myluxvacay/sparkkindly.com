import { z } from 'zod';
import type { Db } from '@/lib/db';
import type { ApiResult } from './api';
import type { Agent } from './auth';

// Publishing reports: the write side of the admin publishing summary (/admin/publishing/). Two narrow writes,
// one per job, so neither job can forge the other's part of a day's record:
// - the reviewer agent reports a finished batch: the items it published and the items it rejected, with reasons.
// - the promoter agent reports the batch's Facebook digest post (URL and/or platform post id).
// Both are idempotent per batch date: a retry replaces the caller's own part of that date's record and leaves
// the other part untouched. The batch date is the jobs' business date (America/New_York run date); the server
// only rejects a date that is clearly wrong (unparseable, or more than a day in the future).

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'not a real date')
  .refine((s) => s <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), 'date is in the future');

const slugSchema = z.string().regex(/^[a-z0-9-]+$/);

const publishedItemSchema = z.object({
  world: slugSchema,
  kind: z.enum(['article', 'activity', 'video', 'quiz']),
  title: z.string().min(1).max(300),
  slug: slugSchema.nullable().optional(),
});

const rejectionSchema = z.object({
  title: z.string().min(1).max(300),
  world: slugSchema.nullable().optional(),
  kind: z.string().max(40).nullable().optional(),
  reason: z.string().min(1).max(500),
});

const reportSchema = z.object({
  date: dateSchema,
  published: z.array(publishedItemSchema).max(200),
  rejections: z.array(rejectionSchema).max(200),
});

const digestSchema = z
  .object({
    date: dateSchema,
    postUrl: z.string().url().startsWith('https://').max(600).optional(),
    externalId: z.string().min(1).max(200).optional(),
  })
  .refine((d) => d.postUrl !== undefined || d.externalId !== undefined, 'postUrl or externalId is required');

const fail = (status: number, error: string, message?: string): ApiResult => ({ status, json: { error, ...(message ? { message } : {}) } });

async function knownWorlds(db: Db, slugs: string[]): Promise<boolean> {
  if (slugs.length === 0) return true;
  const unique = [...new Set(slugs)];
  const known = await db.query<{ slug: string }>('SELECT slug FROM worlds WHERE slug = ANY($1::text[])', [unique]);
  return known.rows.length === unique.length;
}

// POST /api/agent/publishing/report/ (reviewer role, enforced by the route). Replaces the date's published-item
// and rejection lists in one transaction; the digest fields belong to the promoter and are never touched here.
export async function recordReviewReport(db: Db, agent: Agent, input: unknown): Promise<ApiResult> {
  void agent;
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return fail(400, 'invalid_report', parsed.error.issues[0]?.message);
  const { date, published, rejections } = parsed.data;

  const worlds = [...published.map((p) => p.world), ...rejections.map((r) => r.world).filter((w): w is string => !!w)];
  if (!(await knownWorlds(db, worlds))) return fail(400, 'unknown_world');

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO publishing_batches (batch_date) VALUES ($1::date)
       ON CONFLICT (batch_date) DO UPDATE SET updated_at = now()`,
      [date],
    );
    await tx.query('DELETE FROM publishing_items WHERE batch_date = $1::date', [date]);
    await tx.query('DELETE FROM publishing_rejections WHERE batch_date = $1::date', [date]);
    for (const p of published) {
      await tx.query('INSERT INTO publishing_items (batch_date, world, kind, title, slug) VALUES ($1::date, $2, $3, $4, $5)', [
        date,
        p.world,
        p.kind,
        p.title,
        p.slug ?? null,
      ]);
    }
    for (const r of rejections) {
      await tx.query('INSERT INTO publishing_rejections (batch_date, title, world, kind, reason) VALUES ($1::date, $2, $3, $4, $5)', [
        date,
        r.title,
        r.world ?? null,
        r.kind ?? null,
        r.reason,
      ]);
    }
  });
  return { status: 200, json: { ok: true, date, published: published.length, rejections: rejections.length } };
}

// POST /api/agent/publishing/digest/ (promoter role, enforced by the route). Sets only the digest fields of the
// date's batch row, creating the row if the digest somehow lands before the review report.
export async function recordDigestPost(db: Db, agent: Agent, input: unknown, now: Date = new Date()): Promise<ApiResult> {
  void agent;
  const parsed = digestSchema.safeParse(input);
  if (!parsed.success) return fail(400, 'invalid_digest', parsed.error.issues[0]?.message);
  const { date, postUrl, externalId } = parsed.data;

  await db.query(
    `INSERT INTO publishing_batches (batch_date, digest_post_url, digest_external_id, digest_posted_at)
     VALUES ($1::date, $2, $3, $4)
     ON CONFLICT (batch_date) DO UPDATE SET
       digest_post_url = COALESCE(EXCLUDED.digest_post_url, publishing_batches.digest_post_url),
       digest_external_id = COALESCE(EXCLUDED.digest_external_id, publishing_batches.digest_external_id),
       digest_posted_at = EXCLUDED.digest_posted_at,
       updated_at = now()`,
    [date, postUrl ?? null, externalId ?? null, now.toISOString()],
  );
  return { status: 200, json: { ok: true, date } };
}
