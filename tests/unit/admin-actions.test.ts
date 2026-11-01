// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createItem, getItem, type NewItem } from '@/lib/items/repo';
import { createAgent } from '@/lib/agents/admin';
import { authenticate } from '@/lib/agents/auth';
import { getPublicItem } from '@/lib/public/reads';
import { anonymousScope } from '@/lib/public/scope';
import { runAction } from '@/lib/admin/actions';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let playId: number;
let kidsId: number;
let n = 0;
const ADMIN = { email: 'owner@example.test' };
const NOW = new Date('2026-11-05T12:00:00Z');

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const w = (await db.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds')).rows;
  playId = w.find((x) => x.slug === 'play')!.id;
  kidsId = w.find((x) => x.slug === 'kids')!.id;
});
afterAll(async () => {
  await db.close();
});

const act = (name: string, fields: Record<string, string>, now = NOW) => runAction(db, ADMIN, name, new URLSearchParams(fields), now);
const make = (over: Partial<NewItem> = {}) =>
  createItem(db, {
    worldId: playId, kind: 'article', slug: `admin-${++n}`, title: 'A title', summary: 'A summary',
    body: { sections: [{ heading: 'H', paragraphs: ['P'] }] }, audience: 'all', createdBy: 'test', riskTier: 'reflective', ...over,
  });
const audits = async () => (await db.query<{ actor: string; action: string; target: string; detail: unknown }>('SELECT actor, action, target, detail FROM audit_log ORDER BY id')).rows;
const auditCount = async () => (await audits()).length;

describe('runAction', () => {
  it('refuses an unknown action', async () => {
    expect(await act('item.delete_everything', {})).toMatchObject({ ok: false, status: 400 });
  });
});

describe('item actions', () => {
  it('approving a Kids item schedules it with the admin as approver and a future slot, and audits once', async () => {
    const kid = await make({ worldId: kidsId, audience: 'kids', riskTier: 'kids', status: 'in_review' });
    const before = await auditCount();
    expect(await act('item.approve', { id: kid.id })).toMatchObject({ ok: true });
    const after = await getItem(db, kid.id);
    expect(after?.status).toBe('scheduled');
    expect(after?.approvedBy).toBe(ADMIN.email);
    expect(after!.publishAt!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(await auditCount()).toBe(before + 1);
    expect((await audits()).at(-1)).toMatchObject({ actor: ADMIN.email, action: 'item.approve', target: kid.id });
  });

  it('approving an item held back to review with a past publish time gives it a future slot (the held-item fix)', async () => {
    const held = await make({ status: 'in_review', publishAt: new Date('2026-11-01T06:00:00Z') });
    await act('item.approve', { id: held.id });
    expect((await getItem(db, held.id))!.publishAt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('keeps a future publish time the agent asked for', async () => {
    const wanted = new Date('2026-12-24T06:00:00Z');
    const later = await make({ status: 'in_review', publishAt: wanted });
    await act('item.approve', { id: later.id });
    expect((await getItem(db, later.id))!.publishAt).toEqual(wanted);
  });

  it('refuses to approve an item that is not in review, a malformed id and a missing id, writing no audit row', async () => {
    const live = await make({ status: 'scheduled', publishAt: NOW, approvedBy: 'x' });
    const before = await auditCount();
    expect(await act('item.approve', { id: live.id })).toMatchObject({ ok: false, status: 409 });
    expect(await act('item.approve', { id: "1' OR '1'='1" })).toMatchObject({ ok: false, status: 404 });
    expect(await act('item.approve', { id: '00000000-0000-4000-8000-000000000000' })).toMatchObject({ ok: false, status: 404 });
    expect(await act('item.approve', {})).toMatchObject({ ok: false, status: 404 });
    expect(await auditCount()).toBe(before);
  });

  it('never approves a draft (where failed gates wait) or an excluded-tier item, even one in review', async () => {
    const draft = await make({ status: 'draft', qualityReport: { decision: 'quality gates failed; see the quality report' } });
    const excludedDraft = await make({ status: 'draft', riskTier: 'excluded' });
    const excludedInReview = await make({ status: 'in_review', riskTier: 'excluded' });
    const before = await auditCount();
    for (const item of [draft, excludedDraft, excludedInReview]) {
      expect(await act('item.approve', { id: item.id })).toMatchObject({ ok: false, status: 409 });
      expect((await getItem(db, item.id))?.status).toBe(item.status);
    }
    expect(await auditCount()).toBe(before);
  });

  it('unpublishes only published or scheduled items, and rejects only items in review', async () => {
    const draft = await make({ status: 'draft' });
    expect(await act('item.unpublish', { id: draft.id })).toMatchObject({ ok: false, status: 409 });
    expect(await act('item.reject', { id: draft.id })).toMatchObject({ ok: false, status: 409 });
    const live = await make({ status: 'published', publishAt: NOW, approvedBy: 'x' });
    expect(await act('item.reject', { id: live.id })).toMatchObject({ ok: false, status: 409 });
    expect((await getItem(db, draft.id))?.status).toBe('draft');
    expect((await getItem(db, live.id))?.status).toBe('published');
  });

  it('rejects an item in review', async () => {
    const r = await make({ status: 'in_review' });
    expect(await act('item.reject', { id: r.id, reason: 'Off topic' })).toMatchObject({ ok: true });
    expect((await getItem(db, r.id))?.status).toBe('rejected');
  });

  it('unpublishing hides the item from the public site at once', async () => {
    const created = await act('item.create', { world: 'play', title: 'Owner piece', slug: `owner-${++n}`, summary: 'A short summary.', body: 'First paragraph.\n\nSecond paragraph.', audience: 'all' });
    expect(created).toMatchObject({ ok: true });
    const slug = `owner-${n}`;
    const visible = await getPublicItem(db, anonymousScope(new Date()), 'play', slug);
    expect(visible?.title).toBe('Owner piece');
    expect(visible?.body).toEqual({ sections: [{ heading: 'Owner piece', paragraphs: ['First paragraph.', 'Second paragraph.'] }] });
    expect(await act('item.unpublish', { id: visible!.id })).toMatchObject({ ok: true });
    expect(await getPublicItem(db, anonymousScope(new Date()), 'play', slug)).toBeNull();
  });

  it('creating in the Kids world records the Kids tier and the admin as approver', async () => {
    const slug = `kids-owner-${++n}`;
    expect(await act('item.create', { world: 'kids', title: 'Kids piece', slug, summary: 'A short summary.', body: 'Look at a leaf.', audience: 'all' })).toMatchObject({ ok: true });
    const row = (await db.query<{ risk_tier: string; audience: string; approved_by: string }>('SELECT risk_tier, audience, approved_by FROM items WHERE slug = $1', [slug])).rows[0];
    expect(row).toEqual({ risk_tier: 'kids', audience: 'kids', approved_by: ADMIN.email });
  });

  it('refuses bad create input: unknown world, bad slug, taken slug, empty title, bad audience', async () => {
    const base = { world: 'play', title: 'T', slug: `ok-${++n}`, summary: 'S', body: 'B', audience: 'all' };
    expect(await act('item.create', { ...base, world: 'nowhere' })).toMatchObject({ ok: false, status: 400 });
    expect(await act('item.create', { ...base, slug: 'Bad Slug' })).toMatchObject({ ok: false, status: 400 });
    expect(await act('item.create', { ...base, title: '' })).toMatchObject({ ok: false, status: 400 });
    expect(await act('item.create', { ...base, audience: 'everyone' })).toMatchObject({ ok: false, status: 400 });
    expect(await act('item.create', base)).toMatchObject({ ok: true });
    expect(await act('item.create', base)).toMatchObject({ ok: false, status: 409 });
  });

  it('editing title and summary writes a revision and an audit row with the change', async () => {
    const e = await make();
    expect(await act('item.edit', { id: e.id, title: 'New title', summary: 'New summary', reason: 'Typo' })).toMatchObject({ ok: true });
    const after = await getItem(db, e.id);
    expect([after?.title, after?.summary]).toEqual(['New title', 'New summary']);
    const revs = (await db.query<{ reason: string; changed_by: string }>('SELECT reason, changed_by FROM item_revisions WHERE item_id = $1 ORDER BY revision', [e.id])).rows;
    expect(revs.at(-1)).toEqual({ reason: 'Typo', changed_by: ADMIN.email });
    expect(await act('item.edit', { id: e.id, title: 'x'.repeat(141), summary: 'S', reason: 'r' })).toMatchObject({ ok: false, status: 400 });
    expect(await act('item.edit', { id: e.id, title: 'T', summary: 'S', reason: '' })).toMatchObject({ ok: false, status: 400 });
  });
});

describe('report actions', () => {
  it('closes an open report; a bad id is not found', async () => {
    const item = await make({ status: 'published', publishAt: NOW, approvedBy: 'x' });
    const r = await db.query<{ id: string }>("INSERT INTO problem_reports (item_id, reason) VALUES ($1, 'wrong') RETURNING id", [item.id]);
    expect(await act('report.close', { id: r.rows[0].id })).toMatchObject({ ok: true });
    expect((await db.query('SELECT status FROM problem_reports WHERE id = $1', [r.rows[0].id])).rows[0]).toEqual({ status: 'closed' });
    expect(await act('report.close', { id: '999999' })).toMatchObject({ ok: false, status: 404 });
    expect(await act('report.close', { id: '1; DROP TABLE items' })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('world and topic actions', () => {
  it('refuses reserved, taken and malformed world slugs', async () => {
    for (const slug of ['admin', 'quiz', 'api', 'play', 'Bad Slug', 'a', '']) {
      expect(await act('world.create', { slug, name: 'X' }), slug).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('creates a new world disabled, then enables it and edits its text', async () => {
    expect(await act('world.create', { slug: 'wonder', name: 'Wonder' })).toMatchObject({ ok: true });
    expect((await db.query("SELECT enabled FROM worlds WHERE slug = 'wonder'")).rows[0]).toEqual({ enabled: false });
    expect(await act('world.enabled', { slug: 'wonder', enabled: 'true' })).toMatchObject({ ok: true });
    expect(await act('world.update', { slug: 'wonder', name: 'Wonder!', promise: 'P', description: 'D' })).toMatchObject({ ok: true });
    expect((await db.query("SELECT enabled, name, promise FROM worlds WHERE slug = 'wonder'")).rows[0]).toEqual({ enabled: true, name: 'Wonder!', promise: 'P' });
    expect(await act('world.enabled', { slug: 'nowhere', enabled: 'true' })).toMatchObject({ ok: false, status: 404 });
  });

  it('switches a world to review mode and back, but never the Kids world to auto', async () => {
    expect(await act('world.mode', { slug: 'grow', mode: 'review' })).toMatchObject({ ok: true });
    expect(await act('world.mode', { slug: 'grow', mode: 'auto' })).toMatchObject({ ok: true });
    expect(await act('world.mode', { slug: 'kids', mode: 'auto' })).toMatchObject({ ok: false, status: 409 });
    expect(await act('world.mode', { slug: 'grow', mode: 'manual' })).toMatchObject({ ok: false, status: 400 });
  });

  it('creates and renames topics', async () => {
    expect(await act('topic.create', { slug: 'tide-pools', name: 'Tide pools' })).toMatchObject({ ok: true });
    expect(await act('topic.create', { slug: 'tide-pools', name: 'Again' })).toMatchObject({ ok: false, status: 409 });
    expect(await act('topic.create', { slug: 'Tide Pools', name: 'X' })).toMatchObject({ ok: false, status: 400 });
    expect(await act('topic.rename', { slug: 'tide-pools', name: 'Rock pools' })).toMatchObject({ ok: true });
    expect(await act('topic.rename', { slug: 'missing', name: 'X' })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('agent actions (keys)', () => {
  it('creating returns the key once and stores only its hash; the audit row holds neither', async () => {
    const r = await act('agent.create', { name: 'admin-made', world: 'play' });
    expect(r).toMatchObject({ ok: true });
    const key = (r as { secret: string }).secret;
    expect(await authenticate(db, key)).toMatchObject({ name: 'admin-made', worldSlug: 'play' });
    expect(JSON.stringify(await audits())).not.toContain(key);
    expect(JSON.stringify((await db.query("SELECT * FROM agents WHERE name = 'admin-made'")).rows)).not.toContain(key.split('_')[2]);
  });

  it("rotating agent A kills A's old key, the new key works, and agent B's key is untouched", async () => {
    const a = await createAgent(db, 'agent-a', 'play');
    const b = await createAgent(db, 'agent-b', 'grow');
    const r = await act('agent.rotate', { id: String(a.id) });
    expect(r).toMatchObject({ ok: true });
    const fresh = (r as { secret: string }).secret;
    expect(await authenticate(db, a.key)).toBeNull();
    expect(await authenticate(db, fresh)).toMatchObject({ id: a.id });
    expect(await authenticate(db, b.key)).toMatchObject({ id: b.id });
    const rows = await audits();
    expect(JSON.stringify(rows)).not.toContain(fresh);
    expect(JSON.stringify(rows)).not.toContain(a.key);
  });

  it('revoking stops the key at once and re-enabling restores it; unknown and malformed ids are not found', async () => {
    const c = await createAgent(db, 'agent-c', 'discover');
    expect(await act('agent.enabled', { id: String(c.id), enabled: 'false' })).toMatchObject({ ok: true });
    expect(await authenticate(db, c.key)).toBeNull();
    expect(await act('agent.enabled', { id: String(c.id), enabled: 'true' })).toMatchObject({ ok: true });
    expect(await authenticate(db, c.key)).not.toBeNull();
    expect(await act('agent.rotate', { id: '99999' })).toMatchObject({ ok: false, status: 404 });
    expect(await act('agent.rotate', { id: 'abc' })).toMatchObject({ ok: false, status: 404 });
  });

  it('refuses a bad agent name, a taken name and an unknown world', async () => {
    expect(await act('agent.create', { name: 'Bad Name', world: '' })).toMatchObject({ ok: false, status: 400 });
    expect(await act('agent.create', { name: 'agent-a', world: '' })).toMatchObject({ ok: false, status: 409 });
    expect(await act('agent.create', { name: 'agent-z', world: 'nowhere' })).toMatchObject({ ok: false, status: 400 });
  });
});

describe('audit', () => {
  it('every successful action left a row naming the admin, and no row carries a key or token', async () => {
    const rows = await audits();
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) expect(r.actor).toBe(ADMIN.email);
    expect(JSON.stringify(rows)).not.toMatch(/skagt_|key_hash|[0-9a-f]{64}/);
  });
});
