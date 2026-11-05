// @vitest-environment node
// The owner's side of contributions (plan 8 Task 3): the queue, the four admin actions (audited, approve only from
// needs_owner, approval through the item.approve slot path), the change and rejection emails, and the publication email
// sent once per item.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { contributor, itemOf, stateOf, submitted } from '../helpers/contributors';
import type { EmailMessage } from '@/lib/email';
import type { Agent } from '@/lib/agents/auth';
import { runAction } from '@/lib/admin/actions';
import { handleAdminAction } from '@/lib/admin/act';
import { recordVerdict } from '@/lib/contributors/review';
import { ownerContributionQueue, pendingLinks } from '@/lib/contributors/owner';
import { enableContributor } from '@/lib/contributors/profile';
import { sendPublicationNotices } from '@/lib/contributors/notices';
import { publishDue } from '@/lib/jobs/publish-due';
import { person } from '../helpers/comments';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T12:00:00Z');
const admin = { email: 'owner@example.test' };
const env = { ADMIN_LINK_BASE: 'https://s.example.test' };
const master: Agent = { id: 1, name: 'master', worldId: null, worldSlug: null, role: 'content' };
let sent: EmailMessage[] = [];
const send = async (m: EmailMessage) => void sent.push(m);
const act = (name: string, fields: Record<string, string>) => runAction(db, admin, name, new URLSearchParams(fields), NOW, send);
// The version the owner's page showed (the contribution's updated_at as text), as the admin form sends it.
const versionOf = async (id: string) =>
  (await db.query<{ v: string }>('SELECT updated_at::text AS v FROM contributions WHERE id = $1', [id])).rows[0]?.v ?? '';
const decide = async (name: string, id: string, fields: Record<string, string> = {}) => act(name, { id, version: await versionOf(id), ...fields });

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  sent = [];
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('CONTRIBUTORS_ENABLED', 'true');
  vi.stubEnv('ADMIN_LINK_BASE', 'https://s.example.test');
});

// A contribution the reviewer passed: needs_owner, item in_review.
async function needsOwner() {
  const p = await contributor(db, NOW);
  const id = await submitted(db, p, NOW);
  const v = { id, version: '1', pass: true, reasons: ['sources support the claims'], sourcesChecked: ['https://science.nasa.gov/sky'], plagiarismChecked: true };
  expect((await recordVerdict(db, master, v, { env, send })).status).toBe(200);
  return { p, id, itemId: (await stateOf(db, id)).item_id! };
}

describe('the owner queue', () => {
  it('lists needs_owner contributions with their text, reasons and sources; no email or account id', async () => {
    const { p, id } = await needsOwner();
    const q = await ownerContributionQueue(db);
    const entry = q.find((e) => e.id === id)!;
    expect(entry).toMatchObject({ kind: 'article', world: 'discover', revision: 1, reviewReasons: ['sources support the claims'] });
    expect(entry.sections.length).toBe(2);
    expect(JSON.stringify(q)).not.toContain(p.email);
    expect(JSON.stringify(q)).not.toContain(p.id);
  });
});

describe('admin actions', () => {
  it('approve: only from needs_owner, puts the item on the normal slot path, audited', async () => {
    const { id, itemId } = await needsOwner();
    const r = await decide('contribution.approve', id);
    expect(r).toMatchObject({ ok: true, code: 'contribution_approved' });
    expect((await stateOf(db, id)).state).toBe('approved');
    const item = await db.query<{ status: string; publish_at: Date; approved_by: string }>('SELECT status, publish_at, approved_by FROM items WHERE id = $1', [itemId]);
    expect(item.rows[0]).toMatchObject({ status: 'scheduled', approved_by: admin.email });
    expect(item.rows[0].publish_at.getUTCHours()).toBe(6);
    const audit = await db.query<{ action: string; actor: string }>('SELECT action, actor FROM audit_log WHERE target = $1', [`contribution:${id}`]);
    expect(audit.rows.map((a) => a.action)).toContain('contribution.approve');
    expect(await decide('contribution.approve', id)).toMatchObject({ ok: false, status: 409 });
    const p = await contributor(db, NOW);
    const early = await submitted(db, p, NOW);
    expect(await decide('contribution.approve', early)).toMatchObject({ ok: false, status: 409 });
    expect((await stateOf(db, early)).state).toBe('agent_review');
    expect(await act('contribution.approve', { id: 'not-a-uuid', version: 'x' })).toMatchObject({ ok: false, status: 404 });
  });

  it('item.approve from the main queue approves the contribution too (one scheduling path)', async () => {
    const { id, itemId } = await needsOwner();
    expect(await act('item.approve', { id: itemId })).toMatchObject({ ok: true });
    expect((await stateOf(db, id)).state).toBe('approved');
    const other = await needsOwner();
    expect(await act('item.reject', { id: other.itemId, reason: 'no' })).toMatchObject({ ok: false, status: 409, code: 'contributed' });
  });

  it('request changes: notes 1 to 500 characters, emailed (notes only), item back to draft', async () => {
    const { p, id, itemId } = await needsOwner();
    expect(await decide('contribution.request_changes', id, { notes: '' })).toMatchObject({ ok: false, status: 400 });
    expect(await decide('contribution.request_changes', id, { notes: 'x'.repeat(501) })).toMatchObject({ ok: false, status: 400 });
    expect(sent).toHaveLength(0);
    expect(await decide('contribution.request_changes', id, { notes: 'Please cite the second claim.' })).toMatchObject({ ok: true });
    expect(await stateOf(db, id)).toMatchObject({ state: 'changes_requested' });
    expect((await itemOf(db, itemId)).status).toBe('draft');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(p.email);
    expect(sent[0].text).toContain('Please cite the second claim.');
    expect(sent[0].text).not.toContain('sources support the claims');
  });

  it('reject: a reason is required, emailed, item rejected', async () => {
    const { p, id, itemId } = await needsOwner();
    expect(await decide('contribution.reject', id)).toMatchObject({ ok: false, status: 400 });
    expect(await decide('contribution.reject', id, { reason: 'This repeats an existing article.' })).toMatchObject({ ok: true, code: 'contribution_rejected' });
    expect((await stateOf(db, id)).state).toBe('rejected');
    expect((await itemOf(db, itemId)).status).toBe('rejected');
    expect(sent.map((m) => m.to)).toEqual([p.email]);
    expect(sent[0].text).toContain('This repeats an existing article.');
  });

  it('link approve: by the profile page id; nothing to approve is 404', async () => {
    const p = await person(db, NOW);
    const e = await enableContributor(db, p.ctx, { displayName: 'Linker', terms: 'on', link: 'https://example.org/me' }, NOW);
    const slug = e.status === 'enabled' ? e.slug : '';
    expect((await pendingLinks(db)).map((l) => l.slug)).toContain(slug);
    const link = 'https://example.org/me';
    expect(await act('contribution.link_approve', { slug, link })).toMatchObject({ ok: true, code: 'contribution_link_approved' });
    expect((await pendingLinks(db)).map((l) => l.slug)).not.toContain(slug);
    expect(await act('contribution.link_approve', { slug, link })).toMatchObject({ ok: false, status: 404 });
    expect(await act('contribution.link_approve', { slug: 'zzzzzzzzzz', link })).toMatchObject({ ok: false, status: 404 });
  });

  it('a link edited between the page load and the approval is refused, not approved (TOCTOU)', async () => {
    const p = await person(db, NOW);
    const e = await enableContributor(db, p.ctx, { displayName: 'Swapper', terms: 'on', link: 'https://example.org/shown' }, NOW);
    const slug = e.status === 'enabled' ? e.slug : '';
    const shown = (await pendingLinks(db)).find((l) => l.slug === slug)!.link;
    await enableContributor(db, p.ctx, { displayName: 'Swapper', link: 'https://evil.example/swapped' }, NOW);
    expect(await act('contribution.link_approve', { slug, link: shown })).toMatchObject({ ok: false, status: 409, code: 'changed' });
    const row = await db.query<{ link: string; link_approved: boolean }>('SELECT link, link_approved FROM contributor_profiles WHERE slug = $1', [slug]);
    expect(row.rows[0]).toEqual({ link: 'https://evil.example/swapped', link_approved: false });
    expect(await act('contribution.link_approve', { slug })).toMatchObject({ ok: false, status: 400 });
  });

  it('a contribution changed between the page load and the decision is refused, state unchanged (TOCTOU)', async () => {
    const { id } = await needsOwner();
    const seen = await versionOf(id);
    await db.query("UPDATE contributions SET content = jsonb_set(content, '{title}', '\"Changed title\"'), updated_at = now() + interval '1 second' WHERE id = $1", [id]);
    for (const [name, extra] of [
      ['contribution.approve', {}],
      ['contribution.request_changes', { notes: 'Fix it' }],
      ['contribution.reject', { reason: 'No' }],
    ] as const) {
      expect(await act(name, { id, version: seen, ...extra }), name).toMatchObject({ ok: false, status: 409, code: 'changed' });
    }
    expect((await stateOf(db, id)).state).toBe('needs_owner');
    expect(await act('contribution.approve', { id })).toMatchObject({ ok: false, status: 400 });
    expect(sent).toHaveLength(0);
  });

  it('with the flag off every contribution action is unknown; without a session the route goes to sign-in', async () => {
    const { id } = await needsOwner();
    vi.stubEnv('CONTRIBUTORS_ENABLED', '');
    expect(await decide('contribution.approve', id)).toMatchObject({ ok: false, code: 'unknown_action' });
    vi.stubEnv('CONTRIBUTORS_ENABLED', 'true');
    const req = new Request('http://localhost/admin/act/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'sparkkindly.com', origin: 'https://sparkkindly.com' },
      body: new URLSearchParams({ action: 'contribution.approve', id }).toString(),
    });
    const r = await handleAdminAction(req, { db, env: { ADMIN_EMAILS: admin.email }, now: NOW });
    expect(r.headers.get('location')).toBe('/admin/sign-in/');
    expect((await stateOf(db, id)).state).toBe('needs_owner');
  });
});

describe('the publication email', () => {
  it('is sent once per item after it publishes, with the share link and nothing else', async () => {
    const { p, id, itemId } = await needsOwner();
    await decide('contribution.approve', id);
    sent = [];
    expect(await sendPublicationNotices(db, NOW, env, send)).toEqual({ sent: 0, failed: 0 });
    const later = new Date(NOW.getTime() + 3 * 86_400_000);
    await publishDue(db, later);
    expect((await itemOf(db, itemId)).status).toBe('published');
    const r1 = await sendPublicationNotices(db, later, env, send);
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    const mine = sent.filter((m) => m.to === p.email);
    expect(mine).toHaveLength(1);
    const slug = (await db.query<{ slug: string }>('SELECT slug FROM items WHERE id = $1', [itemId])).rows[0].slug;
    expect(mine[0].text).toContain(`https://s.example.test/discover/${slug}/`);
    expect(mine[0].text).not.toMatch(/Writer|sources support/);
    sent = [];
    expect(await sendPublicationNotices(db, later, env, send)).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });
});
