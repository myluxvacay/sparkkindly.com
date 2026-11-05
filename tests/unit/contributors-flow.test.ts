// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { person } from '../helpers/comments';
import {
  DECLARED,
  articleDraft,
  contributor,
  drafted,
  freshLimits,
  itemOf,
  okProbe,
  stateOf,
  submitted,
} from '../helpers/contributors';
import { confirmConsent, issueConsentTokens } from '@/lib/accounts/consent';
import { deleteAccount } from '@/lib/accounts/delete';
import { exportAccount } from '@/lib/accounts/export';
import { enableContributor, getProfile } from '@/lib/contributors/profile';
import { getMine, listMine, saveDraft } from '@/lib/contributors/drafts';
import { submitContribution, withdraw } from '@/lib/contributors/submit';
import { CONTRIBUTOR_LIMITS } from '@/lib/contributors/rules';
import type { AccountContext } from '@/lib/accounts/context';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T10:00:00Z');
const deps = () => ({ probe: okProbe, limits: freshLimits() });

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});

const enable = (ctx: AccountContext | null, over: Record<string, unknown> = {}) =>
  enableContributor(db, ctx, { displayName: 'Ada Writer', terms: 'on', ...over }, NOW);

describe('who may contribute', () => {
  it('16-17 and adults may switch the role on', async () => {
    for (const dob of ['2009-06-01', '1990-05-05']) {
      const p = await person(db, NOW, dob);
      const r = await enable(p.ctx);
      expect(r.status, dob).toBe('enabled');
    }
  });

  it('13-15 (pending or confirmed consent), unverified, comment-banned, child context and anonymous are refused', async () => {
    const pending = await person(db, NOW, '2012-06-01', `parent${Math.random()}@example.test`);
    expect(await enable(pending.ctx)).toEqual({ status: 'refused', code: 'not_allowed' });

    const confirmed = await person(db, NOW, '2012-06-01', `parent${Math.random()}@example.test`);
    const tokens = await issueConsentTokens(db, confirmed.id, NOW);
    expect(await confirmConsent(db, tokens!.confirm, NOW)).toBe('confirmed');
    expect(await enable(confirmed.ctx)).toEqual({ status: 'refused', code: 'not_allowed' });

    const unverified = await person(db, NOW);
    await db.query('UPDATE accounts SET verified_at = NULL WHERE id = $1', [unverified.id]);
    expect(await enable(unverified.ctx)).toEqual({ status: 'refused', code: 'not_allowed' });

    const banned = await person(db, NOW);
    await db.query('INSERT INTO account_trust (account_id, banned) VALUES ($1, true)', [banned.id]);
    expect(await enable(banned.ctx)).toEqual({ status: 'refused', code: 'banned' });

    const parent = await person(db, NOW);
    const childCtx = { ...parent.ctx, profile: { id: '22222222-2222-4222-8222-222222222222', displayName: 'Kid', ageBand: '6-9' } } as AccountContext;
    expect(await enable(childCtx)).toEqual({ status: 'refused', code: 'not_allowed' });
    expect(await enable(null)).toEqual({ status: 'refused', code: 'not_allowed' });
  });

  it('a comment ban after enabling also blocks saving and submitting', async () => {
    const p = await contributor(db, NOW);
    const id = await drafted(db, p, NOW);
    await db.query('INSERT INTO account_trust (account_id, banned) VALUES ($1, true)', [p.id]);
    expect(await saveDraft(db, p.ctx, articleDraft(), NOW, deps())).toEqual({ status: 'refused', code: 'banned' });
    expect(await submitContribution(db, p.ctx, id, DECLARED, NOW, deps())).toEqual({ status: 'refused', code: 'banned' });
  });
});

describe('the contributor profile', () => {
  it('needs the terms ticked and a valid display name; reserved names refused', async () => {
    const p = await person(db, NOW);
    expect(await enable(p.ctx, { terms: undefined })).toEqual({ status: 'refused', code: 'terms' });
    expect(await enable(p.ctx, { displayName: 'Moderator' })).toEqual({ status: 'refused', code: 'name' });
    expect(await enable(p.ctx, { bio: 'visit example.com' })).toEqual({ status: 'refused', code: 'bio' });
    expect(await enable(p.ctx, { link: 'http://example.org/' })).toEqual({ status: 'refused', code: 'link' });
    expect((await enable(p.ctx, { bio: 'I write about maps.' })).status).toBe('enabled');
    const prof = await getProfile(db, p.id);
    expect(prof).toMatchObject({ displayName: 'Ada Writer', bio: 'I write about maps.', link: null, linkApproved: false });
    expect(prof!.slug).toMatch(/^[a-z0-9]{10}$/);
    expect(prof!.termsAcceptedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('a proposed link stays unapproved, and changing it withdraws an earlier approval', async () => {
    const p = await person(db, NOW);
    await enable(p.ctx, { link: 'https://example.org/me' });
    expect(await getProfile(db, p.id)).toMatchObject({ link: 'https://example.org/me', linkApproved: false });
    await db.query('UPDATE contributor_profiles SET link_approved = true WHERE account_id = $1', [p.id]);
    await enable(p.ctx, { link: 'https://example.org/other', terms: undefined });
    expect(await getProfile(db, p.id)).toMatchObject({ link: 'https://example.org/other', linkApproved: false });
  });

  it('16-17 contributors appear under the display name only: no link may be proposed', async () => {
    const p = await person(db, NOW, '2009-06-01');
    expect(await enable(p.ctx, { link: 'https://example.org/me' })).toEqual({ status: 'refused', code: 'link' });
  });
});

describe('drafts', () => {
  it('saving needs the role on; drafts are capped at 5; saves are rate limited', async () => {
    const none = await person(db, NOW);
    expect(await saveDraft(db, none.ctx, articleDraft(), NOW, deps())).toEqual({ status: 'refused', code: 'no_profile' });
    const p = await contributor(db, NOW);
    const limits = freshLimits();
    for (let i = 0; i < CONTRIBUTOR_LIMITS.drafts; i++) {
      expect((await saveDraft(db, p.ctx, articleDraft(), NOW, { limits })).status).toBe('saved');
    }
    expect(await saveDraft(db, p.ctx, articleDraft(), NOW, { limits })).toEqual({ status: 'refused', code: 'draft_limit' });
    const q = await contributor(db, NOW);
    for (let i = 0; i < CONTRIBUTOR_LIMITS.savesPerHour; i++) {
      const id = (await listMine(db, q.id))[0]?.id;
      await saveDraft(db, q.ctx, { ...articleDraft(), id }, NOW, { limits });
    }
    expect(await saveDraft(db, q.ctx, articleDraft(), NOW, { limits })).toEqual({ status: 'refused', code: 'rate' });
  });

  it('an invalid draft is refused with reasons; forged fields are ignored', async () => {
    const p = await contributor(db, NOW);
    const bad = await saveDraft(db, p.ctx, articleDraft({ title: 'x'.repeat(200) }), NOW, deps());
    expect(bad).toMatchObject({ status: 'refused', code: 'invalid' });
    const id = await drafted(db, p, NOW, { status: 'published', audience: 'kids', agent_id: 1, created_by: 'admin' });
    const mine = await getMine(db, p.id, id);
    expect(mine!.state).toBe('draft');
    expect(JSON.stringify(mine!.content)).not.toMatch(/published|kids|admin/);
  });

  it("another account cannot read or overwrite a draft", async () => {
    const a = await contributor(db, NOW);
    const b = await contributor(db, NOW);
    const id = await drafted(db, a, NOW);
    expect(await getMine(db, b.id, id)).toBeNull();
    expect(await saveDraft(db, b.ctx, { ...articleDraft(), id }, NOW, deps())).toEqual({ status: 'refused', code: 'not_found' });
    expect((await listMine(db, b.id)).map((c) => c.id)).not.toContain(id);
  });
});

describe('submitting', () => {
  it('runs the gates; a pass creates a draft item for the reviewer, audience all, created by no person', async () => {
    const p = await contributor(db, NOW);
    const id = await submitted(db, p, NOW);
    const s = await stateOf(db, id);
    expect(s.state).toBe('agent_review');
    const item = await itemOf(db, s.item_id!);
    expect(item).toMatchObject({ status: 'draft', audience: 'all', risk_tier: 'sourced', created_by: 'contributor', agent_id: null });
    const c = await getMine(db, p.id, id);
    expect(c!.revision).toBe(1);
    expect(c!.declaredAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('a gate failure keeps the draft and returns the reasons', async () => {
    const p = await contributor(db, NOW);
    const id = await drafted(db, p, NOW, { sources: [] });
    const r = await submitContribution(db, p.ctx, id, DECLARED, NOW, deps());
    expect(r.status).toBe('gates_failed');
    expect(r.status === 'gates_failed' && r.reasons.join(' ')).toMatch(/source/);
    expect(await stateOf(db, id)).toEqual({ state: 'draft', item_id: null });
    const dead = await drafted(db, p, NOW);
    const r2 = await submitContribution(db, p.ctx, dead, DECLARED, NOW, { probe: async () => ({ status: 404, location: null }), limits: freshLimits() });
    expect(r2.status).toBe('gates_failed');
  });

  it('both declarations are required', async () => {
    const p = await contributor(db, NOW);
    const id = await drafted(db, p, NOW);
    expect(await submitContribution(db, p.ctx, id, { original: 'on' }, NOW, deps())).toEqual({ status: 'refused', code: 'declarations' });
    expect(await submitContribution(db, p.ctx, id, { licence: 'on' }, NOW, deps())).toEqual({ status: 'refused', code: 'declarations' });
  });

  it('a Kids-world contribution is refused even if forced into the stored row', async () => {
    const p = await contributor(db, NOW);
    expect((await saveDraft(db, p.ctx, articleDraft({ world: 'kids' }), NOW, deps())).status).toBe('refused');
    const id = await drafted(db, p, NOW);
    await db.query(
      "UPDATE contributions SET world_id = (SELECT id FROM worlds WHERE slug = 'kids'), content = jsonb_set(content, '{world}', '\"kids\"') WHERE id = $1",
      [id],
    );
    expect(await submitContribution(db, p.ctx, id, DECLARED, NOW, deps())).toEqual({ status: 'refused', code: 'kids' });
    expect((await stateOf(db, id)).item_id).toBeNull();
  });

  it('at most 3 pending, and 5 submissions a day', async () => {
    const p = await contributor(db, NOW);
    for (let i = 0; i < CONTRIBUTOR_LIMITS.pending; i++) await submitted(db, p, NOW);
    const id = await drafted(db, p, NOW);
    expect(await submitContribution(db, p.ctx, id, DECLARED, NOW, deps())).toEqual({ status: 'refused', code: 'pending_limit' });
    const q = await contributor(db, NOW);
    const limits = freshLimits();
    for (let i = 0; i < CONTRIBUTOR_LIMITS.submitsPerDay; i++) limits.submit(q.id);
    const qid = await drafted(db, q, NOW);
    expect(await submitContribution(db, q.ctx, qid, DECLARED, NOW, { probe: okProbe, limits })).toEqual({ status: 'refused', code: 'rate' });
  });

  it('only a draft or changes_requested may be submitted; another account gets not_found', async () => {
    const p = await contributor(db, NOW);
    const id = await submitted(db, p, NOW);
    expect(await submitContribution(db, p.ctx, id, DECLARED, NOW, deps())).toEqual({ status: 'refused', code: 'wrong_state' });
    const other = await contributor(db, NOW);
    const mine = await drafted(db, p, NOW);
    expect(await submitContribution(db, other.ctx, mine, DECLARED, NOW, deps())).toEqual({ status: 'refused', code: 'not_found' });
    expect(await submitContribution(db, other.ctx, 'not-a-uuid', DECLARED, NOW, deps())).toEqual({ status: 'refused', code: 'not_found' });
  });

  it('revising after changes were requested updates the same item and keeps a revision', async () => {
    const p = await contributor(db, NOW);
    const id = await submitted(db, p, NOW);
    const itemId = (await stateOf(db, id)).item_id!;
    await db.query("UPDATE contributions SET state = 'changes_requested' WHERE id = $1", [id]);
    const save = await saveDraft(db, p.ctx, { ...articleDraft({ title: 'A clearer title about blue skies today' }), id }, NOW, deps());
    expect(save.status).toBe('saved');
    expect((await stateOf(db, id)).state).toBe('changes_requested');
    const r = await submitContribution(db, p.ctx, id, DECLARED, NOW, deps());
    expect(r.status).toBe('agent_review');
    expect(await stateOf(db, id)).toEqual({ state: 'agent_review', item_id: itemId });
    expect((await itemOf(db, itemId)).title).toBe('A clearer title about blue skies today');
    expect((await getMine(db, p.id, id))!.revision).toBe(2);
    const revs = await db.query('SELECT 1 FROM item_revisions WHERE item_id = $1', [itemId]);
    expect(revs.rows.length).toBeGreaterThanOrEqual(2);
  });
});

describe('a resubmission whose gates fail (L10)', () => {
  it('stays in changes_requested with the gate reasons, instead of falling back to draft', async () => {
    const p = await contributor(db, NOW);
    const id = await submitted(db, p, NOW);
    await db.query("UPDATE contributions SET state = 'changes_requested' WHERE id = $1", [id]);
    const failing = { ...deps(), probe: async () => ({ status: 404, location: null }) };
    const r = await submitContribution(db, p.ctx, id, DECLARED, NOW, failing);
    expect(r.status).toBe('gates_failed');
    expect((await stateOf(db, id)).state).toBe('changes_requested');
    expect((await getMine(db, p.id, id))!.gateReasons.length).toBeGreaterThan(0);
  });
});

describe("revisions keep the item's kind and world", () => {
  async function requested() {
    const p = await contributor(db, NOW);
    const id = await submitted(db, p, NOW);
    await db.query("UPDATE contributions SET state = 'changes_requested' WHERE id = $1", [id]);
    return { p, id, itemId: (await stateOf(db, id)).item_id! };
  }
  const quizDraft = {
    kind: 'quiz',
    world: 'discover',
    title: 'Which planet is the largest of all?',
    summary: 'A quick question about the planets in our solar system.',
    question: 'Which planet in our solar system is the largest?',
    options: ['Mars', 'Jupiter', 'Venus', 'Earth'],
    correct: 1,
    explanation: 'Jupiter is more than eleven times as wide as Earth.',
    sources: [{ title: 'NASA', url: 'https://science.nasa.gov/jupiter' }],
  };

  it('a revision with a different kind or world (Kids included) is refused and changes nothing', async () => {
    const { p, id } = await requested();
    const before = await getMine(db, p.id, id);
    expect(await saveDraft(db, p.ctx, { ...quizDraft, id }, NOW, deps())).toEqual({ status: 'refused', code: 'item_locked' });
    expect(await saveDraft(db, p.ctx, { ...articleDraft({ world: 'play' }), id }, NOW, deps())).toEqual({ status: 'refused', code: 'item_locked' });
    expect((await saveDraft(db, p.ctx, { ...articleDraft({ world: 'kids' }), id }, NOW, deps())).status).toBe('refused');
    const after = await getMine(db, p.id, id);
    expect(after).toEqual(before);
  });

  it('a contribution row tampered to disagree with its item is refused on submit', async () => {
    for (const tamper of [
      "UPDATE contributions SET world_id = (SELECT id FROM worlds WHERE slug = 'play'), content = jsonb_set(content, '{world}', '\"play\"') WHERE id = $1",
      "UPDATE contributions SET kind = 'quiz', content = jsonb_set(content, '{kind}', '\"quiz\"') WHERE id = $1",
      "UPDATE contributions SET content = jsonb_set(content, '{world}', '\"play\"') WHERE id = $1",
    ]) {
      const { p, id, itemId } = await requested();
      await db.query(tamper, [id]);
      expect(await submitContribution(db, p.ctx, id, DECLARED, NOW, deps())).toEqual({ status: 'refused', code: 'wrong_state' });
      expect((await itemOf(db, itemId)).status).toBe('draft');
    }
  });

  it("Kids is refused on every revision against the item's actual values", async () => {
    for (const tamper of [
      "UPDATE items SET world_id = (SELECT id FROM worlds WHERE slug = 'kids') WHERE id = $1",
      "UPDATE items SET audience = 'kids' WHERE id = $1",
      "UPDATE items SET risk_tier = 'kids' WHERE id = $1",
    ]) {
      const { p, id, itemId } = await requested();
      await db.query(tamper, [itemId]);
      if (tamper.includes('world_id')) {
        await db.query("UPDATE contributions SET world_id = (SELECT id FROM worlds WHERE slug = 'kids'), content = jsonb_set(content, '{world}', '\"kids\"') WHERE id = $1", [id]);
      }
      expect(await submitContribution(db, p.ctx, id, DECLARED, NOW, deps())).toEqual({ status: 'refused', code: 'kids' });
    }
  });

  it("the gates run against the item's world (a Discover item stays Sourced and needs a source)", async () => {
    const { p, id } = await requested();
    await saveDraft(db, p.ctx, { ...articleDraft({ sources: [] }), id }, NOW, deps());
    const r = await submitContribution(db, p.ctx, id, DECLARED, NOW, deps());
    expect(r.status).toBe('gates_failed');
    expect(r.status === 'gates_failed' && r.reasons.join(' ')).toMatch(/source/);
  });

  it('replaceContent cannot change kind, world or audience', async () => {
    const { itemId } = await requested();
    const { replaceContent } = await import('@/lib/items/repo');
    await db.transaction((tx) =>
      replaceContent(tx, itemId, {
        title: 'T', summary: 'S long enough', body: {}, riskTier: 'sourced', sources: [], qualityReport: {}, topics: [], answer: null,
        kind: 'quiz', worldId: 1, world_id: 1, audience: 'kids',
      } as never, 'test', 'test'),
    );
    const row = (await db.query<{ kind: string; audience: string; w: string }>(
      'SELECT i.kind, i.audience, w.slug AS w FROM items i JOIN worlds w ON w.id = i.world_id WHERE i.id = $1', [itemId])).rows[0];
    expect(row).toEqual({ kind: 'article', audience: 'all', w: 'discover' });
  });
});

describe('withdrawal', () => {
  it('withdraws at any stage; a published item is archived at once', async () => {
    const p = await contributor(db, NOW);
    const id = await submitted(db, p, NOW);
    const itemId = (await stateOf(db, id)).item_id!;
    await db.query("UPDATE contributions SET state = 'approved' WHERE id = $1", [id]);
    await db.query("UPDATE items SET status = 'published', published_at = $2, approved_by = 'owner' WHERE id = $1", [itemId, NOW]);
    expect(await withdraw(db, p.ctx, id, NOW)).toBe('withdrawn');
    expect((await stateOf(db, id)).state).toBe('withdrawn');
    expect((await itemOf(db, itemId)).status).toBe('archived');
    expect(await withdraw(db, p.ctx, id, NOW)).toBe('wrong_state');
    const d = await drafted(db, p, NOW);
    expect(await withdraw(db, p.ctx, d, NOW)).toBe('withdrawn');
  });

  it('an in-review item is archived too; another account cannot withdraw', async () => {
    const p = await contributor(db, NOW);
    const id = await submitted(db, p, NOW);
    const itemId = (await stateOf(db, id)).item_id!;
    await db.query("UPDATE contributions SET state = 'needs_owner' WHERE id = $1", [id]);
    await db.query("UPDATE items SET status = 'in_review' WHERE id = $1", [itemId]);
    const other = await contributor(db, NOW);
    expect(await withdraw(db, other.ctx, id, NOW)).toBe('not_found');
    expect(await withdraw(db, p.ctx, id, NOW)).toBe('withdrawn');
    expect((await itemOf(db, itemId)).status).toBe('archived');
  });
});

describe('account deletion and export', () => {
  it('deletion archives published contributed items, deletes unpublished ones, removes profile and contributions', async () => {
    const p = await contributor(db, NOW);
    const pub = await submitted(db, p, NOW);
    const pubItem = (await stateOf(db, pub)).item_id!;
    await db.query("UPDATE items SET status = 'published', published_at = $2, approved_by = 'owner' WHERE id = $1", [pubItem, NOW]);
    const pending = await submitted(db, p, NOW);
    const pendingItem = (await stateOf(db, pending)).item_id!;
    expect(await deleteAccount(db, p.id, NOW)).toBe(true);
    expect((await itemOf(db, pubItem)).status).toBe('archived');
    expect(await itemOf(db, pendingItem)).toBeUndefined();
    expect((await db.query('SELECT 1 FROM contributions WHERE account_id = $1', [p.id])).rows).toHaveLength(0);
    expect(await getProfile(db, p.id)).toBeNull();
  });

  it('deletion does not fail when a sponsorship references a never-published contributed item: it is archived (L4)', async () => {
    const p = await contributor(db, NOW);
    const id = await submitted(db, p, NOW);
    const itemId = (await stateOf(db, id)).item_id!;
    const s = (await db.query<{ id: number }>("INSERT INTO sponsors (name, link) VALUES ('Ref', 'https://ref.example/') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO sponsorships (sponsor_id, item_id, label, ended_at) VALUES ($1, $2, 'L', now())", [s, itemId]);
    expect(await deleteAccount(db, p.id, NOW)).toBe(true);
    expect((await itemOf(db, itemId)).status).toBe('archived');
    expect((await db.query('SELECT 1 FROM contributions WHERE account_id = $1', [p.id])).rows).toHaveLength(0);
  });

  it('the export holds the own profile, drafts, submissions, states and owner notes, nothing of others', async () => {
    const p = await contributor(db, NOW);
    const other = await contributor(db, NOW);
    await drafted(db, other, NOW, { title: 'Someone else entirely different' });
    const id = await submitted(db, p, NOW);
    await db.query("UPDATE contributions SET state = 'changes_requested', owner_notes = 'Please add a source' WHERE id = $1", [id]);
    await drafted(db, p, NOW);
    const x = await exportAccount(db, p.id, NOW);
    expect(x!.contributor).toMatchObject({ displayName: expect.stringMatching(/^Writer/), linkApproved: false });
    expect(x!.contributions).toHaveLength(2);
    expect(x!.contributions.map((c) => c.state).sort()).toEqual(['changes_requested', 'draft']);
    expect(x!.contributions.find((c) => c.state === 'changes_requested')!.ownerNotes).toBe('Please add a source');
    expect(JSON.stringify(x)).not.toContain('Someone else entirely');
    expect(JSON.stringify(x)).not.toContain(id);
  });
});
