import type { Db, Queryable } from '@/lib/db';
import { itemSubmissionSchema, mechanics, supportedKinds, splitAnswer } from '@/lib/items/format';
import { runGates, riskTierFor } from '@/lib/items/gates';
import { decideStatus, lockWorldSlots, nextSlot } from '@/lib/items/policy';
import { insertItem, UnknownTopicError, type StoredItem } from '@/lib/items/repo';
import type { Probe } from '@/lib/items/probe';
import type { Agent } from './auth';

export type ApiResult = { status: number; json: unknown };
type World = { id: number; slug: string; name: string; goals: string | null; approvalMode: 'auto' | 'review'; bufferDays: number };
type Deps = { probe?: Probe; now?: Date };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): ApiResult => ({ status, json: { error, ...extra } });

// A world agent works in its own world only. The master agent names the world on each request.
async function resolveWorld(db: Queryable, agent: Agent, requested: string | null): Promise<{ world: World } | { error: ApiResult }> {
  let slug = agent.worldSlug;
  if (slug) {
    if (requested && requested !== slug) return { error: fail(403, 'forbidden_world', { message: 'This agent may only work in its own world.' }) };
  } else {
    if (!requested) return { error: fail(400, 'world_required', { message: 'Name the world for this request.' }) };
    slug = requested;
  }
  const r = await db.query<{ id: number; slug: string; name: string; goals: string | null; approval_mode: 'auto' | 'review'; buffer_days: number }>(
    'SELECT id, slug, name, goals, approval_mode, buffer_days FROM worlds WHERE slug = $1 AND enabled', [slug]);
  const w = r.rows[0];
  if (!w) return { error: fail(404, 'unknown_world') };
  return { world: { id: w.id, slug: w.slug, name: w.name, goals: w.goals, approvalMode: w.approval_mode, bufferDays: w.buffer_days } };
}

export async function getBrief(db: Queryable, agent: Agent, requestedWorld: string | null, now: Date = new Date()): Promise<ApiResult> {
  const resolved = await resolveWorld(db, agent, requestedWorld);
  if ('error' in resolved) return resolved.error;
  const { world } = resolved;
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  const topics = await db.query<{ slug: string; name: string; recent: string }>(
    `SELECT t.slug, t.name, count(i.id) FILTER (WHERE i.world_id = $1 AND i.created_at > $2::timestamptz) AS recent
     FROM topics t LEFT JOIN item_topics it ON it.topic_id = t.id LEFT JOIN items i ON i.id = it.item_id
     GROUP BY t.id, t.slug, t.name ORDER BY t.slug`,
    [world.id, since],
  );
  const titles = await db.query<{ title: string }>('SELECT title FROM items WHERE world_id = $1 ORDER BY created_at DESC, id LIMIT 30', [world.id]);
  const ahead = await db.query<{ n: string }>(
    "SELECT count(DISTINCT date_trunc('day', publish_at)) AS n FROM items WHERE world_id = $1 AND status = 'scheduled' AND publish_at > $2::timestamptz",
    [world.id, now.toISOString()],
  );
  return {
    status: 200,
    json: {
      today: now.toISOString().slice(0, 10),
      world: { slug: world.slug, name: world.name, goals: world.goals, approvalMode: world.approvalMode, bufferDays: world.bufferDays },
      supported: { kinds: [...supportedKinds], mechanics: [...mechanics] },
      topics: topics.rows.map((t) => ({ slug: t.slug, name: t.name, recentCount: Number(t.recent) })),
      recentTitles: titles.rows.map((t) => t.title),
      scheduledDaysAhead: Number(ahead.rows[0].n),
    },
  };
}

type Existing = { id: string; status: string; quality_report: unknown; publish_at: Date | null };
const summary = (i: Existing, extra: Record<string, unknown> = {}) => ({
  id: i.id, status: i.status, publishAt: i.publish_at ? i.publish_at.toISOString() : null, qualityReport: i.quality_report, ...extra,
});

async function findByKey(db: Queryable, agentId: number, key: string): Promise<Existing | undefined> {
  const r = await db.query<Existing>('SELECT id, status, quality_report, publish_at FROM items WHERE agent_id = $1 AND idempotency_key = $2', [agentId, key]);
  return r.rows[0];
}

export async function submitItem(db: Db, agent: Agent, body: unknown, deps: Deps = {}): Promise<ApiResult> {
  const now = deps.now ?? new Date();
  const parsed = itemSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return fail(422, 'invalid_item', { issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  const sub = parsed.data; // unknown keys, including any client-supplied status or approver, are already gone
  const resolved = await resolveWorld(db, agent, sub.world ?? null);
  if ('error' in resolved) return resolved.error;
  const { world } = resolved;

  const replay = await findByKey(db, agent.id, sub.idempotencyKey);
  if (replay) return { status: 200, json: summary(replay, { replayed: true }) };

  // A draft this agent submitted earlier can be replaced by resubmitting the same slug; anything else holding the slug is final.
  const clash = await db.query<{ id: string; agent_id: number | null; status: string }>(
    "SELECT id, agent_id, status FROM items WHERE world_id = $1 AND locale = 'en' AND slug = $2", [world.id, sub.slug]);
  const existing = clash.rows[0];
  if (existing && !(existing.agent_id === agent.id && existing.status === 'draft')) {
    return fail(409, 'slug_taken', { message: `The slug "${sub.slug}" is already used in this world.` });
  }

  const gates = await runGates(db, sub, { id: world.id, slug: world.slug }, { probe: deps.probe, now, ignoreItemId: existing?.id });
  const blockedTopic = gates.results.find((g) => g.gate === 'blocked-topics' && !g.ok);
  const riskTier = blockedTopic ? 'excluded' : riskTierFor(sub, { id: world.id, slug: world.slug });
  const { body: itemBody, answer } = splitAnswer(sub);

  let stored: StoredItem;
  try {
    stored = await db.transaction(async (tx) => {
      // The slot is chosen under a per-world lock, so two simultaneous submissions cannot take the same day.
      await lockWorldSlots(tx, world.id);
      const decision = decideStatus({
        gatesOk: gates.ok, audience: sub.audience, riskTier, worldApprovalMode: world.approvalMode,
        publishAt: sub.publishAt ? new Date(sub.publishAt) : null, now, slot: await nextSlot(tx, world.id, now),
      });
      if (existing) await tx.query("DELETE FROM items WHERE id = $1 AND status = 'draft' AND agent_id = $2", [existing.id, agent.id]);
      return insertItem(tx, {
        worldId: world.id, kind: sub.kind, slug: sub.slug, title: sub.title, summary: sub.summary, body: itemBody,
        audience: sub.audience, evergreen: sub.evergreen, status: decision.status, publishAt: decision.publishAt,
        createdBy: agent.name, agentId: agent.id, riskTier, sources: sub.sources,
        qualityReport: { riskTier, decision: decision.reason, gates: gates.results },
        image: sub.image ?? { origin: 'template' }, topics: sub.topics, answer, idempotencyKey: sub.idempotencyKey,
      });
    });
  } catch (err) {
    if (err instanceof UnknownTopicError) return fail(422, 'unknown_topic', { topics: err.topics });
    if ((err as { code?: string }).code === '23505') {
      // A simultaneous submission won the race: same key means a replay, otherwise the slug was taken.
      const winner = await findByKey(db, agent.id, sub.idempotencyKey);
      if (winner) return { status: 200, json: summary(winner, { replayed: true }) };
      return fail(409, 'slug_taken', { message: `The slug "${sub.slug}" is already used in this world.` });
    }
    throw err;
  }
  return {
    status: 201,
    json: { id: stored.id, status: stored.status, publishAt: stored.publishAt ? stored.publishAt.toISOString() : null,
      qualityReport: stored.qualityReport },
  };
}

// An agent sees the status of items in its own world (the master sees any). A missing item and someone else's item look the same.
export async function getItemStatus(db: Queryable, agent: Agent, id: string): Promise<ApiResult> {
  if (!UUID.test(id)) return fail(404, 'not_found');
  const r = await db.query<{ id: string; status: string; slug: string; title: string; publish_at: Date | null; quality_report: unknown; world_id: number }>(
    'SELECT id, status, slug, title, publish_at, quality_report, world_id FROM items WHERE id = $1', [id]);
  const item = r.rows[0];
  if (!item || (agent.worldId !== null && item.world_id !== agent.worldId)) return fail(404, 'not_found');
  return {
    status: 200,
    json: { id: item.id, status: item.status, slug: item.slug, title: item.title,
      publishAt: item.publish_at ? item.publish_at.toISOString() : null, qualityReport: item.quality_report },
  };
}
