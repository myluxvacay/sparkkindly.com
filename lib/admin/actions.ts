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
} from '@/lib/items/repo';
import { RESERVED_WORLD_SLUGS } from '@/lib/public/scope';
import { audit } from './audit';

// Every admin change, by name. runAction runs one inside a transaction and writes its audit_log row in the same
// transaction, so a change and its record land together or not at all. The admin comes from the server-side session,
// never from the form. Every id in the form is validated before it reaches SQL (and SQL is parameterised anyway).

export type AdminActionResult =
  | { ok: true; message: string; secret?: string }
  | { ok: false; status: 400 | 404 | 409; message: string };

type Done = { message: string; target: string; detail?: Record<string, unknown>; secret?: string };
type Ctx = { tx: Queryable; admin: { email: string }; form: URLSearchParams; now: Date };
type Handler = (c: Ctx) => Promise<Done>;

class ActionError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}
const bad = (m: string) => new ActionError(400, m);
const missing = (what = 'That item') => new ActionError(404, `${what} was not found.`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{3,80}$/;
const WORLD_SLUG = /^[a-z0-9-]{2,30}$/;
const AGENT_NAME = /^[a-z0-9-]{2,40}$/;

const field = (f: URLSearchParams, name: string) => (f.get(name) ?? '').trim();
function text(f: URLSearchParams, name: string, max: number, min = 1): string {
  const v = field(f, name);
  if (v.length < min || v.length > max) throw bad(`${name} must be ${min} to ${max} characters.`);
  return v;
}
function itemId(f: URLSearchParams): string {
  const id = field(f, 'id');
  if (!UUID.test(id)) throw missing();
  return id;
}
function intId(f: URLSearchParams, what: string): number {
  const id = field(f, 'id');
  if (!/^\d{1,12}$/.test(id)) throw missing(what);
  return Number(id);
}
const flag = (f: URLSearchParams, name: string) => {
  const v = field(f, name);
  if (v !== 'true' && v !== 'false') throw bad(`${name} must be true or false.`);
  return v === 'true';
};

async function worldBySlug(tx: Queryable, slug: string): Promise<{ id: number; slug: string }> {
  const r = await tx.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds WHERE slug = $1', [slug]);
  if (!r.rows[0]) throw bad('There is no such world.');
  return r.rows[0];
}

async function one(tx: Queryable, sql: string, params: unknown[], what: string): Promise<void> {
  const r = await tx.query(sql, params);
  if (!r.rowCount) throw missing(what);
}

const handlers: Record<string, Handler> = {
  // in_review -> scheduled. The slot is the agent's own future publish time if it gave one, else the world's next
  // free slot, chosen under the world's slot lock (an item held back to review keeps no stale past time).
  async 'item.approve'({ tx, admin, form, now }) {
    const id = itemId(form);
    const r = await tx.query<{ world_id: number; publish_at: Date | null }>('SELECT world_id, publish_at FROM items WHERE id = $1 FOR UPDATE', [id]);
    if (!r.rows[0]) throw missing();
    const { world_id: worldId, publish_at: current } = r.rows[0];
    await lockWorldSlots(tx, worldId);
    const publishAt = current && current.getTime() > now.getTime() ? current : await nextSlot(tx, worldId, now);
    await transitionTx(tx, id, 'scheduled', admin.email, 'approved in admin', { by: admin.email });
    await tx.query('UPDATE items SET publish_at = $2 WHERE id = $1', [id, publishAt.toISOString()]);
    return { message: 'Approved and scheduled.', target: id, detail: { publishAt: publishAt.toISOString() } };
  },

  async 'item.reject'({ tx, admin, form }) {
    const id = itemId(form);
    const reason = field(form, 'reason').slice(0, 500) || 'rejected in admin';
    await transitionTx(tx, id, 'rejected', admin.email, reason);
    return { message: 'Rejected.', target: id, detail: { reason } };
  },

  async 'item.unpublish'({ tx, admin, form }) {
    const id = itemId(form);
    await transitionTx(tx, id, 'archived', admin.email, 'unpublished in admin');
    return { message: 'Unpublished.', target: id };
  },

  async 'item.edit'({ tx, admin, form }) {
    const id = itemId(form);
    const title = text(form, 'title', 140);
    const summary = text(form, 'summary', 300);
    const reason = text(form, 'reason', 200);
    if (!(await updateText(tx, id, { title, summary }, admin.email, reason))) throw missing();
    return { message: 'Saved.', target: id, detail: { title, summary, reason } };
  },

  // An owner-written article goes live at once. In the Kids world it is Kids content; the owner is its approver.
  async 'item.create'({ tx, admin, form }) {
    const world = await worldBySlug(tx, field(form, 'world'));
    const slug = field(form, 'slug');
    if (!SLUG.test(slug)) throw bad('The slug must be 3 to 80 lowercase letters, digits or hyphens.');
    const title = text(form, 'title', 140);
    const summary = text(form, 'summary', 300);
    const paragraphs = text(form, 'body', 20_000).split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
    const kids = world.slug === 'kids';
    const audience = kids ? 'kids' : field(form, 'audience');
    if (!['kids', 'all', 'adults'].includes(audience)) throw bad('Choose an audience.');
    const kidsTier = kids || audience === 'kids';
    const item = await insertItem(tx, {
      worldId: world.id, kind: 'article', slug, title, summary, audience: audience as 'kids' | 'all' | 'adults',
      body: { sections: [{ heading: title, paragraphs }] }, status: 'scheduled', publishAt: new Date(),
      createdBy: admin.email, riskTier: kidsTier ? 'kids' : 'reflective', approvedBy: admin.email,
      image: { origin: 'template' }, qualityReport: { decision: 'written and approved by the owner in admin' },
    });
    await transitionTx(tx, item.id, 'published', admin.email, 'published from admin');
    return { message: 'Published.', target: item.id, detail: { world: world.slug, slug } };
  },

  async 'report.close'({ tx, form }) {
    const id = intId(form, 'That report');
    await one(tx, "UPDATE problem_reports SET status = 'closed' WHERE id = $1 AND status = 'open'", [id], 'That open report');
    return { message: 'Report closed.', target: `report:${id}` };
  },

  async 'world.create'({ tx, form }) {
    const slug = field(form, 'slug');
    if (!WORLD_SLUG.test(slug)) throw bad('The slug must be 2 to 30 lowercase letters, digits or hyphens.');
    if (RESERVED_WORLD_SLUGS.includes(slug)) throw bad(`"${slug}" is a page name on the site and cannot be a world.`);
    const name = text(form, 'name', 60);
    const exists = await tx.query('SELECT 1 FROM worlds WHERE slug = $1', [slug]);
    if (exists.rows.length) throw bad('A world with that slug already exists.');
    // New worlds start disabled (nothing shows until the owner enables them) and in review mode.
    await tx.query(
      "INSERT INTO worlds (slug, name, sort, enabled, approval_mode) VALUES ($1, $2, (SELECT COALESCE(max(sort), 0) + 1 FROM worlds), false, 'review')",
      [slug, name],
    );
    return { message: 'World created (disabled until you enable it).', target: `world:${slug}`, detail: { name } };
  },

  async 'world.update'({ tx, form }) {
    const slug = field(form, 'slug');
    const name = text(form, 'name', 60);
    const promise = text(form, 'promise', 120, 0);
    const description = text(form, 'description', 500, 0);
    await one(tx, 'UPDATE worlds SET name = $2, promise = $3, description = $4 WHERE slug = $1', [slug, name, promise, description], 'That world');
    return { message: 'World saved.', target: `world:${slug}`, detail: { name, promise, description } };
  },

  async 'world.enabled'({ tx, form }) {
    const slug = field(form, 'slug');
    const enabled = flag(form, 'enabled');
    await one(tx, 'UPDATE worlds SET enabled = $2 WHERE slug = $1', [slug, enabled], 'That world');
    return { message: enabled ? 'World enabled.' : 'World disabled.', target: `world:${slug}`, detail: { enabled } };
  },

  async 'world.mode'({ tx, form }) {
    const slug = field(form, 'slug');
    const mode = field(form, 'mode');
    if (mode !== 'auto' && mode !== 'review') throw bad('The mode must be auto or review.');
    if (slug === 'kids' && mode === 'auto') throw new ActionError(409, 'The Kids world always stays in review mode.');
    await one(tx, 'UPDATE worlds SET approval_mode = $2 WHERE slug = $1', [slug, mode], 'That world');
    return { message: `World set to ${mode}.`, target: `world:${slug}`, detail: { mode } };
  },

  async 'topic.create'({ tx, form }) {
    const slug = field(form, 'slug');
    if (!SLUG.test(slug)) throw bad('The slug must be 3 to 80 lowercase letters, digits or hyphens.');
    const name = text(form, 'name', 60);
    await tx.query('INSERT INTO topics (slug, name) VALUES ($1, $2)', [slug, name]);
    return { message: 'Topic added.', target: `topic:${slug}`, detail: { name } };
  },

  async 'topic.rename'({ tx, form }) {
    const slug = field(form, 'slug');
    const name = text(form, 'name', 60);
    await one(tx, 'UPDATE topics SET name = $2 WHERE slug = $1', [slug, name], 'That topic');
    return { message: 'Topic renamed.', target: `topic:${slug}`, detail: { name } };
  },

  async 'agent.create'({ tx, form }) {
    const name = field(form, 'name');
    if (!AGENT_NAME.test(name)) throw bad('The name must be 2 to 40 lowercase letters, digits or hyphens.');
    const world = field(form, 'world') || null;
    if (world) await worldBySlug(tx, world);
    const taken = await tx.query('SELECT 1 FROM agents WHERE name = $1', [name]);
    if (taken.rows.length) throw new ActionError(409, 'An agent with that name already exists.');
    const { id, key } = await createAgent(tx, name, world);
    return { message: 'Agent created. Copy its key now: it is shown once.', target: `agent:${id}`, detail: { name, world }, secret: key };
  },

  // A new prefix and hash replace the old ones, so the old key stops working at once.
  async 'agent.rotate'({ tx, form }) {
    const id = intId(form, 'That agent');
    const { key, prefix, hash } = generateKey();
    await one(tx, 'UPDATE agents SET key_prefix = $2, key_hash = $3, key_rotated_at = now() WHERE id = $1', [id, prefix, hash], 'That agent');
    return { message: 'Key rotated. Copy the new key now: it is shown once.', target: `agent:${id}`, secret: key };
  },

  async 'agent.enabled'({ tx, form }) {
    const id = intId(form, 'That agent');
    const enabled = flag(form, 'enabled');
    await one(tx, 'UPDATE agents SET enabled = $2 WHERE id = $1', [id, enabled], 'That agent');
    return { message: enabled ? 'Agent enabled.' : 'Agent revoked.', target: `agent:${id}`, detail: { enabled } };
  },
};

export const actionNames = Object.keys(handlers);

function asResult(err: unknown): AdminActionResult {
  if (err instanceof ActionError) return { ok: false, status: err.status, message: err.message };
  if (err instanceof NotFoundError) return { ok: false, status: 404, message: 'That item was not found.' };
  if (err instanceof IllegalTransitionError) return { ok: false, status: 409, message: `An item cannot move from ${err.from} to ${err.to}.` };
  if (err instanceof ApprovalRequiredError) return { ok: false, status: 409, message: err.message };
  const code = (err as { code?: string }).code;
  if (code === '23505') return { ok: false, status: 409, message: 'That already exists.' };
  if (code === '23514') return { ok: false, status: 409, message: 'The database refused that change (a safety rule).' };
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
  if (!handler) return { ok: false, status: 400, message: 'Unknown action.' };
  try {
    return await db.transaction(async (tx) => {
      const done = await handler({ tx, admin, form, now });
      await audit(tx, admin.email, name, done.target, done.detail ?? {});
      return { ok: true as const, message: done.message, ...(done.secret ? { secret: done.secret } : {}) };
    });
  } catch (err) {
    return asResult(err);
  }
}
