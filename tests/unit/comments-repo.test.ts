// @vitest-environment node
// Comments (plan 7A Task 1): who may post where, replies, edits, deletion and the public listing. Every identity is
// derived from the server-side context and stored rows, never from the caller's input.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { activeModerator } from '../helpers/comments';
import { seedReference } from '@/db/seed';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { getContext, switchToProfile, type AccountContext } from '@/lib/accounts/context';
import { createChildProfile } from '@/lib/accounts/children';
import { deleteAccount } from '@/lib/accounts/delete';
import { setTrust } from '@/lib/comments/trust';
import {
  commentsAllowedFor,
  deleteComment,
  editComment,
  listOwnPending,
  listPublishedComments,
  postComment,
} from '@/lib/comments/repo';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const NOW = new Date('2026-11-05T12:00:00Z');
const MIN = 60_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const worlds: Record<string, number> = {};
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  await activeModerator(db);
  for (const w of (await db.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds')).rows) worlds[w.slug] = w.id;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM items');
  await db.query('UPDATE worlds SET comments_enabled = (slug <> $1)', ['kids']);
});

async function item(o: { world?: string; audience?: string; status?: string } = {}): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1, 'article', $2, 'T', 'S', '{}'::jsonb, $3, $4, '2026-10-31T00:00:00Z', 'test', 'reflective', 'test') RETURNING id`,
    [worlds[o.world ?? 'play'], `c-item-${n++}`, o.audience ?? 'all', o.status ?? 'published'],
  );
  return r.rows[0].id;
}

async function person(dateOfBirth = '1990-05-05', parentEmail?: string) {
  const email = `com${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth, parentEmail }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, {}, T0))!, T0))!;
  const ctx = (await getContext(db, session, NOW))!;
  return { id: r.accountId, email, session, ctx };
}
const first = { displayName: 'Sam', guidelines: 'on' };
const post = (ctx: AccountContext | null, itemId: string, body: string, o: Record<string, unknown> = {}, now = NOW) =>
  postComment(db, ctx, { itemId, body, ...first, ...o }, now);
async function posted(ctx: AccountContext, itemId: string, body: string, o: Record<string, unknown> = {}, now = NOW) {
  const r = await post(ctx, itemId, body, o, now);
  if (r.status === 'refused') throw new Error(`refused: ${r.code}`);
  return r.id;
}
const level1 = (id: string) => db.transaction((tx) => setTrust(tx, id, { level: 1 }));
const statusOf = async (id: string) =>
  (await db.query<{ status: string; body: string }>('SELECT status, body FROM comments WHERE id = $1', [id])).rows[0];

describe('who may post', () => {
  it('adults and 16-17 may; 13-15 (confirmed or pending), unverified, child, missing context may not', async () => {
    const it1 = await item();
    expect((await post((await person()).ctx, it1, 'adult here')).status).toBe('held');
    expect((await post((await person('2010-01-01')).ctx, it1, 'older teen here')).status).toBe('held');
    const pending = await person('2012-01-01', `p${n++}@example.test`);
    expect(await post(pending.ctx, it1, 'young teen')).toEqual({ status: 'refused', code: 'not_allowed' });
    await db.query("UPDATE accounts SET consent_state = 'confirmed' WHERE id = $1", [pending.id]);
    expect(await post((await getContext(db, pending.session, NOW))!, it1, 'young teen')).toEqual({ status: 'refused', code: 'not_allowed' });
    const u = await signUp(db, { email: `unv${n++}@example.test`, dateOfBirth: '1980-01-01' }, T0);
    if (u.status !== 'created') throw new Error('sign-up failed');
    const forged = { account: { id: u.accountId, email: 'x', ageGroup: 'adult', consent: 'none', consentAt: null }, profile: null, audiences: [] };
    expect(await post(forged as unknown as AccountContext, it1, 'unverified')).toEqual({ status: 'refused', code: 'not_allowed' });
    expect(await post(null, it1, 'nobody')).toEqual({ status: 'refused', code: 'not_allowed' });
    const parent = await person();
    const kid = await createChildProfile(db, parent.id, { displayName: 'Kid', ageBand: '10-12', guardianConfirmed: 'on', pin: '4826' }, T0);
    if (kid.status !== 'created') throw new Error('profile failed');
    expect(await switchToProfile(db, parent.session, kid.profileId, NOW)).toBe(true);
    const child = (await getContext(db, parent.session, NOW))!;
    expect(await post(child, it1, 'child')).toEqual({ status: 'refused', code: 'not_allowed' });
    expect((await db.query('SELECT count(*)::int AS n FROM comments')).rows[0].n).toBe(2);
  });

  it('re-derives the age from the stored date of birth, not the context', async () => {
    const teen = await person('2012-01-01', `p${n++}@example.test`);
    await db.query("UPDATE accounts SET consent_state = 'confirmed' WHERE id = $1", [teen.id]);
    const lying = { ...teen.ctx, account: { ...teen.ctx.account, ageGroup: 'adult' as const } };
    expect(await post(lying, await item(), 'hello')).toEqual({ status: 'refused', code: 'not_allowed' });
  });

  it('a banned account cannot post', async () => {
    const p = await person();
    await db.transaction((tx) => setTrust(tx, p.id, { banned: true }));
    expect(await post(p.ctx, await item(), 'hello')).toEqual({ status: 'refused', code: 'banned' });
  });

  it('the first comment needs a display name and the guidelines ticked; later ones need neither', async () => {
    const p = await person();
    const it1 = await item();
    expect(await post(p.ctx, it1, 'hello', { displayName: '' })).toEqual({ status: 'refused', code: 'name' });
    expect(await post(p.ctx, it1, 'hello', { displayName: 'me@example.test' })).toEqual({ status: 'refused', code: 'name' });
    expect(await post(p.ctx, it1, 'hello', { guidelines: undefined })).toEqual({ status: 'refused', code: 'guidelines' });
    expect((await post(p.ctx, it1, 'hello', { displayName: ' Ｓam ' })).status).toBe('held');
    const t = (await db.query('SELECT display_name, guidelines_accepted_at FROM account_trust WHERE account_id = $1', [p.id])).rows[0];
    expect(t).toEqual({ display_name: 'Sam', guidelines_accepted_at: NOW });
    expect((await post(p.ctx, it1, 'again', { displayName: undefined, guidelines: undefined })).status).toBe('held');
  });

  it('level 0 is held, level 1 is published at once', async () => {
    const p = await person();
    const it1 = await item();
    expect((await post(p.ctx, it1, 'first')).status).toBe('held');
    await level1(p.id);
    expect((await post(p.ctx, it1, 'second')).status).toBe('published');
  });
});

describe('where', () => {
  it('never on a Kids world item or an audience=kids item, whatever the toggles', async () => {
    const p = await person();
    await level1(p.id);
    await db.query('UPDATE worlds SET comments_enabled = true');
    for (const id of [await item({ world: 'kids', audience: 'kids' }), await item({ world: 'kids' }), await item({ audience: 'kids' })]) {
      await db.query('UPDATE items SET comments_enabled = true WHERE id = $1', [id]);
      expect(await post(p.ctx, id, 'hello')).toEqual({ status: 'refused', code: 'comments_off' });
      expect(await commentsAllowedFor(db, id, NOW)).toBe(false);
      await db.query("INSERT INTO comments (item_id, account_id, body, status) VALUES ($1, $2, 'sneaked in', 'published')", [id, p.id]);
      expect(await listPublishedComments(db, id, NOW)).toEqual([]);
    }
  });

  it('only on published, visible items; unknown and malformed ids are no_item', async () => {
    const p = await person();
    expect(await post(p.ctx, await item({ status: 'draft' }), 'hello')).toEqual({ status: 'refused', code: 'no_item' });
    expect(await post(p.ctx, '00000000-0000-0000-0000-000000000001', 'hello')).toEqual({ status: 'refused', code: 'no_item' });
    expect(await post(p.ctx, 'nope', 'hello')).toEqual({ status: 'refused', code: 'no_item' });
  });

  it('world and item switches: the item override beats the world, null inherits', async () => {
    const p = await person();
    const it1 = await item();
    await db.query("UPDATE worlds SET comments_enabled = false WHERE slug = 'play'");
    expect(await commentsAllowedFor(db, it1, NOW)).toBe(false);
    expect(await post(p.ctx, it1, 'hello')).toEqual({ status: 'refused', code: 'comments_off' });
    await db.query('UPDATE items SET comments_enabled = true WHERE id = $1', [it1]);
    expect(await commentsAllowedFor(db, it1, NOW)).toBe(true);
    await db.query("UPDATE worlds SET comments_enabled = true WHERE slug = 'play'");
    await db.query('UPDATE items SET comments_enabled = false WHERE id = $1', [it1]);
    expect(await commentsAllowedFor(db, it1, NOW)).toBe(false);
    await db.query('UPDATE items SET comments_enabled = NULL WHERE id = $1', [it1]);
    expect(await commentsAllowedFor(db, it1, NOW)).toBe(true);
  });
});

describe('replies', () => {
  it('one level, same item, parent published or held by the same author', async () => {
    const a = await person();
    const b = await person();
    await level1(a.id);
    const it1 = await item();
    const it2 = await item();
    const top = await posted(a.ctx, it1, 'top');
    const reply = await posted(b.ctx, it1, 'reply', { parentId: top });
    expect((await statusOf(reply)).status).toBe('held');
    expect(await post(a.ctx, it1, 'deeper', { parentId: reply })).toEqual({ status: 'refused', code: 'no_parent' });
    expect(await post(a.ctx, it2, 'cross', { parentId: top })).toEqual({ status: 'refused', code: 'no_parent' });
    const heldTop = await posted(b.ctx, it1, 'held top');
    expect(await post(a.ctx, it1, 'to held', { parentId: heldTop })).toEqual({ status: 'refused', code: 'no_parent' });
    expect((await post(b.ctx, it1, 'own held', { parentId: heldTop })).status).toBe('held');
    expect(await post(a.ctx, it1, 'bad', { parentId: 'nope' })).toEqual({ status: 'refused', code: 'no_parent' });
    for (const status of ['hidden', 'deleted', 'rejected']) {
      await db.query(`UPDATE comments SET status = $2, body = CASE WHEN $2 = 'deleted' THEN '' ELSE 'top' END WHERE id = $1`, [top, status]);
      expect(await post(b.ctx, it1, `to ${status}`, { parentId: top }), status).toEqual({ status: 'refused', code: 'no_parent' });
    }
  });
});

describe('rate limits and duplicates (explicit clock)', () => {
  it('5 per 10 minutes', async () => {
    const p = await person();
    await level1(p.id);
    const it1 = await item();
    for (let i = 0; i < 5; i++) await posted(p.ctx, it1, `note ${i}`, {}, at(i * MIN));
    expect(await post(p.ctx, it1, 'sixth', {}, at(9 * MIN))).toEqual({ status: 'refused', code: 'rate' });
    expect((await post(p.ctx, it1, 'sixth', {}, at(10 * MIN + 1))).status).toBe('published');
  });

  it('40 per day', async () => {
    const p = await person();
    const it1 = await item();
    await posted(p.ctx, it1, 'first');
    await db.query(
      `INSERT INTO comments (item_id, account_id, body, status, created_at)
       SELECT $1, $2, 'old ' || g, 'held', $3::timestamptz + g * interval '20 minutes' FROM generate_series(1, 39) g`,
      [it1, p.id, at(-(23 * 60 + 50) * MIN).toISOString()],
    );
    expect(await post(p.ctx, it1, 'one more', {}, at(MIN))).toEqual({ status: 'refused', code: 'rate' });
    expect((await post(p.ctx, it1, 'one more', {}, at(31 * MIN))).status).toBe('held');
  });

  it('same body by the same author in 24 hours, or the same body published on the item, is a duplicate', async () => {
    const a = await person();
    const b = await person();
    const it1 = await item();
    const it2 = await item();
    await level1(a.id); // published, so the item-wide check applies to others (7A review L1: never others' held text)
    await posted(a.ctx, it1, 'Lovely  idea');
    expect(await post(a.ctx, it2, 'lovely idea', {}, at(MIN))).toEqual({ status: 'refused', code: 'duplicate' });
    expect(await post(b.ctx, it1, 'Lovely idea')).toEqual({ status: 'refused', code: 'duplicate' });
    expect((await post(a.ctx, it2, 'lovely idea', {}, at(24 * 60 * MIN + 1))).status).toBe('published');
  });

  it('links: refused at level 0, accepted as text at level 1', async () => {
    const p = await person();
    const it1 = await item();
    expect(await post(p.ctx, it1, 'see www.example.org')).toEqual({ status: 'refused', code: 'link' });
    await level1(p.id);
    expect((await post(p.ctx, it1, 'see www.example.org')).status).toBe('published');
  });
});

describe('edit and delete', () => {
  it('edits within 15 minutes (exactly 15 allowed), never after, never another author’s', async () => {
    const a = await person();
    const b = await person();
    await level1(a.id);
    const it1 = await item();
    const c = await posted(a.ctx, it1, 'first words');
    expect(await editComment(db, a.id, c, 'better words', at(15 * MIN))).toBe('saved');
    expect(await statusOf(c)).toEqual({ status: 'published', body: 'better words' });
    expect(await editComment(db, a.id, c, 'late words', at(15 * MIN + 1))).toBe('too_late');
    expect(await editComment(db, b.id, c, 'not mine', at(MIN))).toBe('not_found');
    expect(await editComment(db, a.id, 'nope', 'x', at(MIN))).toBe('not_found');
    expect((await statusOf(c)).body).toBe('better words');
  });

  it('re-runs the checks: a level-0 edit adding a link is refused; a published level-0 comment goes back to held', async () => {
    const p = await person();
    const it1 = await item();
    const c = await posted(p.ctx, it1, 'plain words');
    expect(await editComment(db, p.id, c, 'now with evil.com', at(MIN))).toBe('link');
    expect(await editComment(db, p.id, c, 'shit', at(MIN))).toBe('blocked');
    await db.query("UPDATE comments SET status = 'published' WHERE id = $1", [c]);
    expect(await editComment(db, p.id, c, 'kinder words', at(MIN))).toBe('held');
    expect(await statusOf(c)).toEqual({ status: 'held', body: 'kinder words' });
  });

  it('delete empties the body, keeps the row, and the reply keeps its place; another author cannot delete', async () => {
    const a = await person();
    const b = await person();
    await level1(a.id);
    await level1(b.id);
    const it1 = await item();
    const top = await posted(a.ctx, it1, 'top words');
    const reply = await posted(b.ctx, it1, 'reply words', { parentId: top }, at(MIN));
    expect(await deleteComment(db, b.id, top, NOW)).toBe(false);
    expect(await deleteComment(db, a.id, top, NOW)).toBe(true);
    expect(await statusOf(top)).toEqual({ status: 'deleted', body: '' });
    expect(await deleteComment(db, a.id, top, NOW)).toBe(false);
    const list = await listPublishedComments(db, it1, NOW);
    expect(list.map((c) => [c.id, c.parentId, c.deleted, c.body])).toEqual([
      [top, null, true, ''],
      [reply, top, false, 'reply words'],
    ]);
    expect(list[0].displayName).toBeNull();
  });
});

describe('listing', () => {
  it('published only, with the comment id, name, body and time; no account ids or emails', async () => {
    const a = await person();
    const b = await person();
    await level1(a.id);
    const it1 = await item();
    const pub = await posted(a.ctx, it1, 'shown words', { displayName: 'Ann' });
    const held = await posted(b.ctx, it1, 'held words');
    for (const status of ['hidden', 'rejected']) {
      await db.query(`INSERT INTO comments (item_id, account_id, body, status) VALUES ($1, $2, $3, $4)`, [it1, a.id, status, status]);
    }
    const list = await listPublishedComments(db, it1, NOW, a.id);
    expect(list).toEqual([
      { id: pub, parentId: null, displayName: 'Ann', body: 'shown words', createdAt: NOW, deleted: false, mine: true },
    ]);
    expect((await listPublishedComments(db, it1, NOW, b.id))[0].mine).toBe(false);
    const text = JSON.stringify(list);
    for (const s of [a.id, b.id, a.email, held]) expect(text).not.toContain(s);
    expect(await listOwnPending(db, b.id, it1, NOW)).toEqual([{ id: held, parentId: null, body: 'held words', createdAt: NOW }]);
    expect(await listOwnPending(db, a.id, it1, NOW)).toEqual([]);
    await db.query("UPDATE worlds SET comments_enabled = false WHERE slug = 'play'");
    expect(await listPublishedComments(db, it1, NOW)).toEqual([]);
    expect(await listOwnPending(db, b.id, it1, NOW)).toEqual([]);
  });

  it('deleting an account removes its comments and the replies under them', async () => {
    const a = await person();
    const b = await person();
    await level1(a.id);
    await level1(b.id);
    const it1 = await item();
    const top = await posted(a.ctx, it1, 'top words');
    await posted(b.ctx, it1, 'reply words', { parentId: top });
    const keep = await posted(b.ctx, it1, 'other words');
    expect(await deleteAccount(db, a.id, NOW)).toBe(true);
    expect((await db.query<{ id: string }>('SELECT id FROM comments')).rows.map((r) => r.id)).toEqual([keep]);
    expect((await db.query('SELECT count(*)::int AS n FROM account_trust WHERE account_id = $1', [a.id])).rows[0].n).toBe(0);
  });
});

describe('7A review fixes', () => {
  it("M1: an author cannot delete a hidden or rejected comment, so its hidden replies never reappear under a placeholder", async () => {
    const it1 = await item();
    const a = await person();
    const b = await person();
    await level1(a.id);
    await level1(b.id);
    const top = await posted(a.ctx, it1, 'parent words');
    await posted(b.ctx, it1, 'reply words', { parentId: top });
    for (const status of ['hidden', 'rejected']) {
      await db.query('UPDATE comments SET status = $2 WHERE id = $1', [top, status]);
      expect(await deleteComment(db, a.id, top, NOW), status).toBe(false);
      expect((await statusOf(top)).status).toBe(status);
      expect(await listPublishedComments(db, it1, NOW)).toEqual([]);
    }
  });

  it("L1: the item-wide duplicate check matches published comments and the author's own, never others' held text", async () => {
    const it1 = await item();
    const a = await person();
    const b = await person();
    await posted(a.ctx, it1, 'the same words');
    expect((await post(b.ctx, it1, 'The  same words')).status).toBe('held');
    await level1(a.id);
    await posted(a.ctx, it1, 'published words');
    expect(await post(b.ctx, it1, 'published words')).toEqual({ status: 'refused', code: 'duplicate' });
    const c = await person();
    await db.query("INSERT INTO comments (item_id, account_id, body, status) VALUES ($1, $2, 'my hidden words', 'hidden')", [it1, c.id]);
    expect(await post(c.ctx, it1, 'my hidden words')).toEqual({ status: 'refused', code: 'duplicate' });
  });

  it('L5: a parent or item deleted mid-flight (foreign key 23503) is a refusal, not an error', async () => {
    const it1 = await item();
    const a = await person();
    const failing = (constraint: string) =>
      ({
        ...db,
        transaction: async () => {
          throw Object.assign(new Error('violates foreign key'), { code: '23503', constraint });
        },
      }) as typeof db;
    expect(await postComment(failing('comments_parent_id_fkey'), a.ctx, { itemId: it1, body: 'x', ...first }, NOW)).toEqual({ status: 'refused', code: 'no_parent' });
    expect(await postComment(failing('comments_item_id_fkey'), a.ctx, { itemId: it1, body: 'x', ...first }, NOW)).toEqual({ status: 'refused', code: 'no_item' });
    const other = { ...db, transaction: async () => { throw Object.assign(new Error('boom'), { code: '23514' }); } } as typeof db;
    await expect(postComment(other, a.ctx, { itemId: it1, body: 'x', ...first }, NOW)).rejects.toThrow('boom');
  });
});
