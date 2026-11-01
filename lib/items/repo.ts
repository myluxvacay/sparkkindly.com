import type { Db, Queryable } from '@/lib/db';

export type Status = 'draft' | 'in_review' | 'scheduled' | 'published' | 'rejected' | 'archived';
export type Kind = 'article' | 'game' | 'quiz' | 'video_script' | 'puzzle';
export type Audience = 'kids' | 'all' | 'adults';
export type RiskTier = 'excluded' | 'sourced' | 'computable' | 'reflective' | 'kids';

// The only legal status moves. Publishing happens from scheduled; an owner unpublishes by archiving.
export const allowedTransitions: Record<Status, Status[]> = {
  draft: ['in_review', 'scheduled', 'rejected', 'archived'],
  in_review: ['scheduled', 'rejected', 'draft'],
  scheduled: ['published', 'draft', 'archived'],
  published: ['archived'],
  rejected: ['draft'],
  archived: ['draft'],
};

const MAX_REVISIONS = 10;

export class UnknownTopicError extends Error {
  constructor(public readonly topics: string[]) {
    super(`Unknown topic(s): ${topics.join(', ')}`);
    this.name = 'UnknownTopicError';
  }
}
export class IllegalTransitionError extends Error {
  constructor(public readonly from: Status, public readonly to: Status) {
    super(`An item cannot move from ${from} to ${to}`);
    this.name = 'IllegalTransitionError';
  }
}
export class ApprovalRequiredError extends Error {
  constructor() {
    super('Kids content needs owner approval before it can be scheduled or published');
    this.name = 'ApprovalRequiredError';
  }
}
export class NotFoundError extends Error {
  constructor(what = 'Item') {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export type NewItem = {
  worldId: number;
  kind: Kind;
  slug: string;
  locale?: string;
  title: string;
  summary: string;
  body: unknown;
  audience: Audience;
  evergreen?: boolean;
  status?: Status;
  publishAt?: Date | null;
  createdBy: string;
  agentId?: number | null;
  riskTier: RiskTier;
  sources?: unknown[];
  qualityReport?: unknown;
  image?: unknown;
  topics?: string[];
  answer?: { value: unknown; explanation: string } | null;
  idempotencyKey?: string | null;
  approvedBy?: string | null;
};

export type StoredItem = {
  id: string;
  worldId: number;
  kind: Kind;
  slug: string;
  locale: string;
  title: string;
  summary: string;
  body: unknown;
  audience: Audience;
  evergreen: boolean;
  status: Status;
  publishAt: Date | null;
  publishedAt: Date | null;
  createdBy: string;
  agentId: number | null;
  riskTier: RiskTier;
  sources: unknown[];
  qualityReport: unknown;
  image: unknown;
  approvedBy: string | null;
  approvedAt: Date | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// What a visitor may see. There is deliberately no answer, explanation, quality report or approver here.
export type PublicItem = {
  id: string;
  world: string;
  kind: Kind;
  slug: string;
  title: string;
  summary: string;
  body: unknown;
  audience: Audience;
  evergreen: boolean;
  publishedAt: Date;
  sources: unknown[];
  image: unknown;
  topics: string[];
};

const ITEM_COLUMNS = `id, world_id, kind, slug, locale, title, summary, body, audience, evergreen, status, publish_at,
  published_at, created_by, agent_id, risk_tier, sources, quality_report, image, approved_by, approved_at,
  idempotency_key, created_at, updated_at`;

type Row = Record<string, unknown>;

function toStored(r: Row): StoredItem {
  return {
    id: r.id as string, worldId: r.world_id as number, kind: r.kind as Kind, slug: r.slug as string,
    locale: r.locale as string, title: r.title as string, summary: r.summary as string, body: r.body,
    audience: r.audience as Audience, evergreen: r.evergreen as boolean, status: r.status as Status,
    publishAt: r.publish_at as Date | null, publishedAt: r.published_at as Date | null, createdBy: r.created_by as string,
    agentId: r.agent_id as number | null, riskTier: r.risk_tier as RiskTier, sources: r.sources as unknown[],
    qualityReport: r.quality_report, image: r.image, approvedBy: r.approved_by as string | null,
    approvedAt: r.approved_at as Date | null, idempotencyKey: r.idempotency_key as string | null,
    createdAt: r.created_at as Date, updatedAt: r.updated_at as Date,
  };
}

// The database refuses a Kids item in scheduled/published without an approver; surface that as a clear error.
function domainError(err: unknown): unknown {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e?.code === '23514' && (e.constraint === 'kids_requires_approval' || /kids_requires_approval/.test(e.message ?? ''))) {
    return new ApprovalRequiredError();
  }
  return err;
}

async function writeRevision(tx: Queryable, itemId: string, snapshot: unknown, by: string, reason: string | null) {
  await tx.query(
    `INSERT INTO item_revisions (item_id, revision, snapshot, changed_by, reason)
     SELECT $1, COALESCE(max(revision), 0) + 1, $2::jsonb, $3, $4 FROM item_revisions WHERE item_id = $1`,
    [itemId, JSON.stringify(snapshot), by, reason],
  );
  await tx.query(
    `DELETE FROM item_revisions WHERE item_id = $1
       AND revision <= (SELECT max(revision) FROM item_revisions WHERE item_id = $1) - $2`,
    [itemId, MAX_REVISIONS],
  );
}

const snapshotOf = (i: StoredItem) => ({
  status: i.status, title: i.title, summary: i.summary, body: i.body, audience: i.audience, approvedBy: i.approvedBy,
});

export async function createItem(db: Db, input: NewItem): Promise<StoredItem> {
  return db.transaction(async (tx) => {
    const topics = input.topics ?? [];
    let topicIds: number[] = [];
    if (topics.length) {
      const found = await tx.query<{ id: number; slug: string }>('SELECT id, slug FROM topics WHERE slug = ANY($1)', [topics]);
      const missing = topics.filter((t) => !found.rows.some((r) => r.slug === t));
      if (missing.length) throw new UnknownTopicError(missing);
      topicIds = found.rows.map((r) => r.id);
    }
    let stored: StoredItem;
    try {
      const r = await tx.query<Row>(
        `INSERT INTO items (world_id, kind, slug, locale, title, summary, body, audience, evergreen, status, publish_at,
                            created_by, agent_id, risk_tier, sources, quality_report, image, idempotency_key, approved_by, approved_at)
         VALUES ($1, $2, $3, COALESCE($4, 'en'), $5, $6, $7::jsonb, $8, COALESCE($9, false), COALESCE($10, 'draft'), $11,
                 $12, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, $18, $19, CASE WHEN $19::text IS NULL THEN NULL ELSE now() END)
         RETURNING ${ITEM_COLUMNS}`,
        [input.worldId, input.kind, input.slug, input.locale ?? null, input.title, input.summary, JSON.stringify(input.body),
          input.audience, input.evergreen ?? null, input.status ?? null, input.publishAt ?? null, input.createdBy,
          input.agentId ?? null, input.riskTier, JSON.stringify(input.sources ?? []), JSON.stringify(input.qualityReport ?? {}),
          JSON.stringify(input.image ?? {}), input.idempotencyKey ?? null, input.approvedBy ?? null],
      );
      stored = toStored(r.rows[0]);
    } catch (err) {
      throw domainError(err);
    }
    for (const topicId of topicIds) {
      await tx.query('INSERT INTO item_topics (item_id, topic_id) VALUES ($1, $2)', [stored.id, topicId]);
    }
    if (input.answer) {
      await tx.query('INSERT INTO item_answers (item_id, answer, explanation) VALUES ($1, $2::jsonb, $3)', [
        stored.id, JSON.stringify(input.answer.value), input.answer.explanation,
      ]);
    }
    await writeRevision(tx, stored.id, snapshotOf(stored), input.createdBy, 'created');
    return stored;
  });
}

export async function getItem(db: Queryable, id: string): Promise<StoredItem | null> {
  const r = await db.query<Row>(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = $1`, [id]);
  return r.rows[0] ? toStored(r.rows[0]) : null;
}

export async function transition(
  db: Db,
  id: string,
  to: Status,
  by: string,
  reason?: string,
  approval?: { by: string },
): Promise<StoredItem> {
  return db.transaction(async (tx) => {
    const current = await tx.query<{ status: Status }>('SELECT status FROM items WHERE id = $1 FOR UPDATE', [id]);
    if (!current.rows[0]) throw new NotFoundError();
    const from = current.rows[0].status;
    if (!allowedTransitions[from].includes(to)) throw new IllegalTransitionError(from, to);
    let stored: StoredItem;
    try {
      const r = await tx.query<Row>(
        `UPDATE items SET
           status = $2,
           published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END,
           approved_by = COALESCE($3::text, approved_by),
           approved_at = CASE WHEN $3::text IS NOT NULL THEN now() ELSE approved_at END,
           updated_at = now()
         WHERE id = $1
         RETURNING ${ITEM_COLUMNS}`,
        [id, to, approval?.by ?? null],
      );
      stored = toStored(r.rows[0]);
    } catch (err) {
      throw domainError(err);
    }
    await writeRevision(tx, id, snapshotOf(stored), by, reason ?? `${from} -> ${to}`);
    return stored;
  });
}

const PUBLIC_SELECT = `
  SELECT i.id, w.slug AS world, i.kind, i.slug, i.title, i.summary, i.body, i.audience, i.evergreen, i.published_at,
         i.sources, i.image,
         COALESCE(ARRAY(SELECT t.slug FROM item_topics it JOIN topics t ON t.id = it.topic_id
                        WHERE it.item_id = i.id ORDER BY t.slug), '{}') AS topics
  FROM items i JOIN worlds w ON w.id = i.world_id`;

const toPublic = (r: Row): PublicItem => ({
  id: r.id as string, world: r.world as string, kind: r.kind as Kind, slug: r.slug as string, title: r.title as string,
  summary: r.summary as string, body: r.body, audience: r.audience as Audience, evergreen: r.evergreen as boolean,
  publishedAt: r.published_at as Date, sources: r.sources as unknown[], image: r.image, topics: r.topics as string[],
});

export async function getPublishedItem(db: Queryable, worldSlug: string, slug: string, locale = 'en'): Promise<PublicItem | null> {
  const r = await db.query<Row>(
    `${PUBLIC_SELECT} WHERE i.status = 'published' AND w.slug = $1 AND i.slug = $2 AND i.locale = $3`,
    [worldSlug, slug, locale],
  );
  return r.rows[0] ? toPublic(r.rows[0]) : null;
}

export async function listPublished(
  db: Queryable,
  opts: { world?: string; limit: number; offset: number },
): Promise<PublicItem[]> {
  const r = await db.query<Row>(
    `${PUBLIC_SELECT} WHERE i.status = 'published' AND ($1::text IS NULL OR w.slug = $1)
     ORDER BY i.published_at DESC, i.id LIMIT $2 OFFSET $3`,
    [opts.world ?? null, opts.limit, opts.offset],
  );
  return r.rows.map(toPublic);
}

// The only reader of answers. Used for server-side answer checking; never exposed by a public read.
export async function getAnswer(db: Queryable, itemId: string): Promise<{ value: unknown; explanation: string } | null> {
  const r = await db.query<{ answer: unknown; explanation: string }>('SELECT answer, explanation FROM item_answers WHERE item_id = $1', [itemId]);
  return r.rows[0] ? { value: r.rows[0].answer, explanation: r.rows[0].explanation } : null;
}
