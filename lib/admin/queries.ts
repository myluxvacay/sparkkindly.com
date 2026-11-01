import type { Queryable } from '@/lib/db';
import { getItem, type StoredItem } from '@/lib/items/repo';

// Read models for the admin pages. All parameterised; a filter value that is not one of the known ones is ignored.

const STATUSES = ['draft', 'in_review', 'scheduled', 'published', 'rejected', 'archived'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QueueRow = {
  id: string; title: string; world: string; kind: string; audience: string; riskTier: string; createdBy: string;
  createdAt: Date; decision: string | null;
};

export async function listQueue(db: Queryable): Promise<QueueRow[]> {
  const r = await db.query<QueueRow>(
    `SELECT i.id, i.title, w.slug AS world, i.kind, i.audience, i.risk_tier AS "riskTier", i.created_by AS "createdBy",
            i.created_at AS "createdAt", i.quality_report->>'decision' AS decision
     FROM items i JOIN worlds w ON w.id = i.world_id WHERE i.status = 'in_review' ORDER BY i.created_at LIMIT 200`,
  );
  return r.rows;
}

export type ItemRow = { id: string; title: string; world: string; slug: string; kind: string; status: string; publishAt: Date | null };

export async function listItems(db: Queryable, f: { status?: string; world?: string; q?: string }): Promise<ItemRow[]> {
  const status = f.status && STATUSES.includes(f.status) ? f.status : null;
  const q = f.q?.trim().slice(0, 100) || null;
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const r = await db.query<ItemRow>(
    `SELECT i.id, i.title, w.slug AS world, i.slug, i.kind, i.status, i.publish_at AS "publishAt"
     FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE ($1::text IS NULL OR i.status = $1) AND ($2::text IS NULL OR w.slug = $2) AND ($3::text IS NULL OR i.title ILIKE $3)
     ORDER BY i.updated_at DESC, i.id LIMIT 100`,
    [status, f.world || null, like],
  );
  return r.rows;
}

export type ItemDetail = {
  item: StoredItem;
  world: string;
  revisions: { revision: number; changedBy: string; reason: string | null; createdAt: Date }[];
  reports: { id: string; reason: string; message: string; status: string; createdAt: Date }[];
};

export async function getItemDetail(db: Queryable, id: string): Promise<ItemDetail | null> {
  if (!UUID.test(id)) return null;
  const item = await getItem(db, id);
  if (!item) return null;
  const world = (await db.query<{ slug: string }>('SELECT slug FROM worlds WHERE id = $1', [item.worldId])).rows[0].slug;
  const revisions = await db.query<ItemDetail['revisions'][number]>(
    `SELECT revision, changed_by AS "changedBy", reason, created_at AS "createdAt" FROM item_revisions
     WHERE item_id = $1 ORDER BY revision DESC`,
    [id],
  );
  const reports = await db.query<ItemDetail['reports'][number]>(
    `SELECT id::text, reason, message, status, created_at AS "createdAt" FROM problem_reports WHERE item_id = $1 ORDER BY created_at DESC`,
    [id],
  );
  return { item, world, revisions: revisions.rows, reports: reports.rows };
}

export type ReportRow = {
  id: string; reason: string; message: string; createdAt: Date; itemId: string; title: string; world: string; slug: string;
  itemStatus: string; qualityReport: unknown;
};

export async function listReports(db: Queryable): Promise<ReportRow[]> {
  const r = await db.query<ReportRow>(
    `SELECT p.id::text, p.reason, p.message, p.created_at AS "createdAt", i.id AS "itemId", i.title, w.slug AS world, i.slug,
            i.status AS "itemStatus", i.quality_report AS "qualityReport"
     FROM problem_reports p JOIN items i ON i.id = p.item_id JOIN worlds w ON w.id = i.world_id
     WHERE p.status = 'open' ORDER BY p.created_at LIMIT 200`,
  );
  return r.rows;
}

export type WorldRow = { slug: string; name: string; promise: string | null; description: string | null; enabled: boolean; approvalMode: string };

export async function listWorldsAdmin(db: Queryable): Promise<WorldRow[]> {
  const r = await db.query<WorldRow>(
    'SELECT slug, name, promise, description, enabled, approval_mode AS "approvalMode" FROM worlds ORDER BY sort, slug',
  );
  return r.rows;
}

export async function listTopicsAdmin(db: Queryable): Promise<{ slug: string; name: string; items: number }[]> {
  const r = await db.query<{ slug: string; name: string; items: number }>(
    `SELECT t.slug, t.name, count(it.item_id)::int AS items FROM topics t LEFT JOIN item_topics it ON it.topic_id = t.id
     GROUP BY t.id, t.slug, t.name ORDER BY t.slug`,
  );
  return r.rows;
}

export type AgentRow = { id: number; name: string; world: string | null; enabled: boolean; lastRunAt: Date | null; keyAgeDays: number };

export async function listAgents(db: Queryable): Promise<AgentRow[]> {
  const r = await db.query<AgentRow>(
    `SELECT a.id, a.name, w.slug AS world, a.enabled, a.last_run_at AS "lastRunAt", floor(extract(epoch FROM now() - COALESCE(a.key_rotated_at, a.created_at)) / 86400)::int AS "keyAgeDays"
     FROM agents a LEFT JOIN worlds w ON w.id = a.world_id ORDER BY a.name`,
  );
  return r.rows;
}

export type RunHistory = {
  failed: { job: string; error: string; attempts: number; at: Date }[];
  runs: { job: string; runKey: string; at: Date }[];
  publishedPerDay: { day: string; n: number }[];
};

export async function runHistory(db: Queryable): Promise<RunHistory> {
  const failed = await db.query<RunHistory['failed'][number]>('SELECT job, error, attempts, at FROM failed_jobs ORDER BY at DESC LIMIT 50');
  const runs = await db.query<RunHistory['runs'][number]>('SELECT job, run_key AS "runKey", at FROM job_runs ORDER BY at DESC LIMIT 30');
  const per = await db.query<{ day: string; n: number }>(
    `SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD') AS day, count(*)::int AS n FROM events
     WHERE name = 'item_published' GROUP BY 1 ORDER BY 1 DESC LIMIT 14`,
  );
  return { failed: failed.rows, runs: runs.rows, publishedPerDay: per.rows };
}
