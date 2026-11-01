import type { Db, Queryable } from '@/lib/db';
import { createAgent } from '@/lib/agents/admin';
import { generateKey } from '@/lib/agents/keys';
import { lockWorldSlots, nextSlot } from '@/lib/items/policy';
import {
  ApprovalRequiredError,
  IllegalTransitionError,
  insertItem,
  NotFoundError,
  transitionTx,
  updateText,
  type Status,
} from '@/lib/items/repo';
import { RESERVED_WORLD_SLUGS } from '@/lib/public/scope';
import { audit } from './audit';
import { DONE, ERRORS, type DoneCode, type ErrorCode } from './messages';

// Every admin change, by name. runAction runs one inside a transaction and writes its audit_log row in the same
// transaction, so a change and its record land together or not at all. The admin comes from the server-side session,
// never from the form. Every id in the form is validated before it reaches SQL (and SQL is parameterised anyway).
// Each status change names the statuses it may start from and locks the item before checking.

export type AdminActionResult =
  | { ok: true; code: DoneCode; message: string; secret?: string }
  | { ok: false; status: 400 | 404 | 409; code: ErrorCode; message: string };

type Done = { code: DoneCode; target: string; detail?: Record<string, unknown>; secret?: string };
type Ctx = { tx: Queryable; admin: { email: string }; form: URLSearchParams; now: Date };
type Handler = (c: Ctx) => Promise<Done>;

class ActionError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    public readonly code: ErrorCode,
  ) {
    super(ERRORS[code]);
  }
}
const bad = () => new ActionError(400, 'bad_input');
const missing = () => new ActionError(404, 'not_found');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{3,80}$/;
const WORLD_SLUG = /^[a-z0-9-]{2,30}$/;
const AGENT_NAME = /^[a-z0-9-]{2,40}$/;

const field = (f: URLSearchParams, name: string) => (f.get(name) ?? '').trim();
function text(f: URLSearchParams, name: string, max: number, min = 1): string {
  const v = field(f, name);
  if (v.length < min || v.length > max) throw bad();
  return v;
}
function itemId(f: URLSearchParams): string {
  const id = field(f, 'id');
  if (!UUID.test(id)) throw missing();
  return id;
}
function intId(f: URLSearchParams): number {
  const id = field(f, 'id');
  if (!/^\d{1,12}$/.test(id)) throw missing();
  return Number(id);
}
const flag = (f: URLSearchParams, name: string) => {
  const v = field(f, name);
  if (v !== 'true' && v !== 'false') throw bad();
  return v === 'true';
};

type LockedItem = { status: Status; world_id: number; publish_at: Date | null; risk_tier: string };

// Locks the item and refuses unless it is in one of the statuses this action may start from.
async function lockItem(tx: Queryable, id: string, from: Status[]): Promise<LockedItem> {
  const r = await tx.query<LockedItem>('SELECT status, world_id, publish_at, risk_tier FROM items WHERE id = $1 FOR UPDATE', [id]);
  const item = r.rows[0];
  if (!item) throw missing();
  if (!from.includes(item.status)) throw new ActionError(409, 'wrong_status');
  return item;
}

async function worldBySlug(tx: Queryable, slug: string): Promise<{ id: number; slug: string }> {
  const r = await tx.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds WHERE slug = $1', [slug]);
  if (!r.rows[0]) throw bad();
  return r.rows[0];
}

async function one(tx: Queryable, sql: string, params: unknown[]): Promise<void> {
  const r = await tx.query(sql, params);
  if (!r.rowCount) throw missing();
}

const handlers: Record<string, Handler> = {
  // in_review -> scheduled, never from draft (where failed gates wait) and never for excluded content. The slot is the
  // agent's own future publish time if it gave one, else the world's next free slot, chosen under the world's slot
  // lock (an item held back to review keeps no stale past time).
  async 'item.approve'({ tx, admin, form, now }) {
    const id = itemId(form);
    const item = await lockItem(tx, id, ['in_review']);
    if (item.risk_tier === 'excluded') throw new ActionError(409, 'excluded');
    await lockWorldSlots(tx, item.world_id);
    const current = item.publish_at;
    const publishAt = current && current.getTime() > now.getTime() ? current : await nextSlot(tx, item.world_id, now);
    await transitionTx(tx, id, 'scheduled', admin.email, 'approved in admin', { by: admin.email });
    await tx.query('UPDATE items SET publish_at = $2 WHERE id = $1', [id, publishAt.toISOString()]);
    return { code: 'approved', target: id, detail: { publishAt: publishAt.toISOString() } };
  },

  async 'item.reject'({ tx, admin, form }) {
    const id = itemId(form);
    await lockItem(tx, id, ['in_review']);
    const reason = field(form, 'reason').slice(0, 500) || 'rejected in admin';
    await transitionTx(tx, id, 'rejected', admin.email, reason);
    return { code: 'rejected', target: id, detail: { reason } };
  },

  async 'item.unpublish'({ tx, admin, form }) {
    const id = itemId(form);
    await lockItem(tx, id, ['published', 'scheduled']);
    await transitionTx(tx, id, 'archived', admin.email, 'unpublished in admin');
    return { code: 'unpublished', target: id };
  },

  // Text corrections are allowed in any status: they change no status and are kept as a revision.
  async 'item.edit'({ tx, admin, form }) {
    const id = itemId(form);
    const title = text(form, 'title', 140);
    const summary = text(form, 'summary', 300);
    const reason = text(form, 'reason', 200);
    if (!(await updateText(tx, id, { title, summary }, admin.email, reason))) throw missing();
    return { code: 'saved', target: id, detail: { title, summary, reason } };
  },

  // An owner-written article goes live at once. In the Kids world it is Kids content; the owner is its approver.
  async 'item.create'({ tx, admin, form }) {
    const world = await worldBySlug(tx, field(form, 'world'));
    const slug = field(form, 'slug');
    if (!SLUG.test(slug)) throw bad();
    const title = text(form, 'title', 140);
    const summary = text(form, 'summary', 300);
    const paragraphs = text(form, 'body', 20_000).split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
    const kids = world.slug === 'kids';
    const audience = kids ? 'kids' : field(form, 'audience');
    if (!['kids', 'all', 'adults'].includes(audience)) throw bad();
    const kidsTier = kids || audience === 'kids';
    const item = await insertItem(tx, {
      worldId: world.id, kind: 'article', slug, title, summary, audience: audience as 'kids' | 'all' | 'adults',
      body: { sections: [{ heading: title, paragraphs }] }, status: 'scheduled', publishAt: new Date(),
      createdBy: admin.email, riskTier: kidsTier ? 'kids' : 'reflective', approvedBy: admin.email,
      image: { origin: 'template' }, qualityReport: { decision: 'written and approved by the owner in admin' },
    });
    await transitionTx(tx, item.id, 'published', admin.email, 'published from admin');
    return { code: 'published', target: item.id, detail: { world: world.slug, slug } };
  },

  async 'report.close'({ tx, form }) {
    const id = intId(form);
    await one(tx, "UPDATE problem_reports SET status = 'closed' WHERE id = $1 AND status = 'open'", [id]);
    return { code: 'report_closed', target: `report:${id}` };
  },

  async 'world.create'({ tx, form }) {
    const slug = field(form, 'slug');
    if (!WORLD_SLUG.test(slug)) throw bad();
    if (RESERVED_WORLD_SLUGS.includes(slug)) throw new ActionError(400, 'reserved_slug');
    const name = text(form, 'name', 60);
    const exists = await tx.query('SELECT 1 FROM worlds WHERE slug = $1', [slug]);
    if (exists.rows.length) throw new ActionError(400, 'exists');
    // New worlds start disabled (nothing shows until the owner enables them) and in review mode.
    await tx.query(
      "INSERT INTO worlds (slug, name, sort, enabled, approval_mode) VALUES ($1, $2, (SELECT COALESCE(max(sort), 0) + 1 FROM worlds), false, 'review')",
      [slug, name],
    );
    return { code: 'world_created', target: `world:${slug}`, detail: { name } };
  },

  async 'world.update'({ tx, form }) {
    const slug = field(form, 'slug');
    const name = text(form, 'name', 60);
    const promise = text(form, 'promise', 120, 0);
    const description = text(form, 'description', 500, 0);
    await one(tx, 'UPDATE worlds SET name = $2, promise = $3, description = $4 WHERE slug = $1', [slug, name, promise, description]);
    return { code: 'world_saved', target: `world:${slug}`, detail: { name, promise, description } };
  },

  async 'world.enabled'({ tx, form }) {
    const slug = field(form, 'slug');
    const enabled = flag(form, 'enabled');
    await one(tx, 'UPDATE worlds SET enabled = $2 WHERE slug = $1', [slug, enabled]);
    return { code: enabled ? 'world_enabled' : 'world_disabled', target: `world:${slug}`, detail: { enabled } };
  },

  async 'world.mode'({ tx, form }) {
    const slug = field(form, 'slug');
    const mode = field(form, 'mode');
    if (mode !== 'auto' && mode !== 'review') throw bad();
    if (slug === 'kids' && mode === 'auto') throw new ActionError(409, 'kids_review');
    await one(tx, 'UPDATE worlds SET approval_mode = $2 WHERE slug = $1', [slug, mode]);
    return { code: 'world_mode', target: `world:${slug}`, detail: { mode } };
  },

  async 'topic.create'({ tx, form }) {
    const slug = field(form, 'slug');
    if (!SLUG.test(slug)) throw bad();
    const name = text(form, 'name', 60);
    await tx.query('INSERT INTO topics (slug, name) VALUES ($1, $2)', [slug, name]);
    return { code: 'topic_added', target: `topic:${slug}`, detail: { name } };
  },

  async 'topic.rename'({ tx, form }) {
    const slug = field(form, 'slug');
    const name = text(form, 'name', 60);
    await one(tx, 'UPDATE topics SET name = $2 WHERE slug = $1', [slug, name]);
    return { code: 'topic_renamed', target: `topic:${slug}`, detail: { name } };
  },

  async 'agent.create'({ tx, form }) {
    const name = field(form, 'name');
    if (!AGENT_NAME.test(name)) throw bad();
    const world = field(form, 'world') || null;
    if (world) await worldBySlug(tx, world);
    const taken = await tx.query('SELECT 1 FROM agents WHERE name = $1', [name]);
    if (taken.rows.length) throw new ActionError(409, 'exists');
    const { id, key } = await createAgent(tx, name, world);
    return { code: 'agent_created', target: `agent:${id}`, detail: { name, world }, secret: key };
  },

  // A new prefix and hash replace the old ones, so the old key stops working at once.
  async 'agent.rotate'({ tx, form }) {
    const id = intId(form);
    const { key, prefix, hash } = generateKey();
    await one(tx, 'UPDATE agents SET key_prefix = $2, key_hash = $3, key_rotated_at = now() WHERE id = $1', [id, prefix, hash]);
    return { code: 'agent_rotated', target: `agent:${id}`, secret: key };
  },

  async 'agent.enabled'({ tx, form }) {
    const id = intId(form);
    const enabled = flag(form, 'enabled');
    await one(tx, 'UPDATE agents SET enabled = $2 WHERE id = $1', [id, enabled]);
    return { code: enabled ? 'agent_enabled' : 'agent_revoked', target: `agent:${id}`, detail: { enabled } };
  },
};

export const actionNames = Object.keys(handlers);

const failure = (status: 400 | 404 | 409, code: ErrorCode): AdminActionResult => ({ ok: false, status, code, message: ERRORS[code] });

function asResult(err: unknown): AdminActionResult {
  if (err instanceof ActionError) return failure(err.status, err.code);
  if (err instanceof NotFoundError) return failure(404, 'not_found');
  if (err instanceof IllegalTransitionError) return failure(409, 'wrong_status');
  if (err instanceof ApprovalRequiredError) return failure(409, 'needs_approval');
  const code = (err as { code?: string }).code;
  if (code === '23505') return failure(409, 'exists');
  if (code === '23514') return failure(409, 'safety_rule');
  throw err;
}

export async function runAction(
  db: Db,
  admin: { email: string },
  name: string,
  form: URLSearchParams,
  now: Date = new Date(),
): Promise<AdminActionResult> {
  const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
  if (!handler) return failure(400, 'unknown_action');
  try {
    return await db.transaction(async (tx) => {
      const done = await handler({ tx, admin, form, now });
      await audit(tx, admin.email, name, done.target, done.detail ?? {});
      return { ok: true as const, code: done.code, message: DONE[done.code], ...(done.secret ? { secret: done.secret } : {}) };
    });
  } catch (err) {
    return asResult(err);
  }
}
