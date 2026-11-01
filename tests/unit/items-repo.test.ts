// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import {
  allowedTransitions, createItem, transition, getItem, getAnswer,
  IllegalTransitionError, ApprovalRequiredError, UnknownTopicError, NotFoundError, type NewItem, type Status,
} from '@/lib/items/repo';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let playId: number;
let kidsId: number;
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const w = await db.query<{ slug: string; id: number }>('SELECT slug, id FROM worlds');
  playId = w.rows.find((r) => r.slug === 'play')!.id;
  kidsId = w.rows.find((r) => r.slug === 'kids')!.id;
});
afterAll(async () => {
  await db.close();
});

const make = (over: Partial<NewItem> = {}) =>
  createItem(db, {
    worldId: playId, kind: 'article', slug: `item-${++n}`, title: 'A title', summary: 'A summary',
    body: { sections: [] }, audience: 'all', createdBy: 'test', riskTier: 'reflective', ...over,
  });
const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0].n);

describe('createItem', () => {
  it('stores the topics, the answer row and revision 1', async () => {
    const item = await make({
      kind: 'quiz', topics: ['physics', 'space'], body: { mechanic: 'true_false', prompt: 'Is the sky blue?' },
      answer: { value: true, explanation: 'Because of how air scatters sunlight.' },
    });
    expect(await count('SELECT count(*) n FROM item_topics WHERE item_id = $1', [item.id])).toBe(2);
    expect((await getAnswer(db, item.id))?.value).toBe(true);
    expect(await count('SELECT count(*) n FROM item_revisions WHERE item_id = $1 AND revision = 1', [item.id])).toBe(1);
    expect(item.status).toBe('draft');
  });

  it('rejects an unknown topic and leaves nothing behind', async () => {
    const before = await count('SELECT count(*) n FROM items');
    await expect(make({ topics: ['physics', 'not-a-topic'] })).rejects.toBeInstanceOf(UnknownTopicError);
    expect(await count('SELECT count(*) n FROM items')).toBe(before);
  });

  it('cannot create a Kids item already scheduled without approval', async () => {
    await expect(make({ worldId: kidsId, audience: 'kids', riskTier: 'kids', status: 'scheduled' })).rejects.toBeInstanceOf(ApprovalRequiredError);
  });
});

describe('transition', () => {
  it('follows the allowed map, every legal move succeeds', async () => {
    for (const [from, tos] of Object.entries(allowedTransitions) as [Status, Status[]][]) {
      for (const to of tos) {
        const item = await make({ status: from });
        const moved = await transition(db, item.id, to, 'tester');
        expect(moved.status, `${from} -> ${to}`).toBe(to);
      }
    }
  });

  it('rejects every move that is not in the map', async () => {
    const statuses = Object.keys(allowedTransitions) as Status[];
    for (const from of statuses) {
      for (const to of statuses.filter((s) => s !== from && !allowedTransitions[from].includes(s))) {
        const item = await make({ status: from });
        await expect(transition(db, item.id, to, 'tester'), `${from} -> ${to}`).rejects.toBeInstanceOf(IllegalTransitionError);
      }
    }
  });

  it('does not allow an unpublished item to be edited back from published to draft', async () => {
    const item = await make({ status: 'published' });
    await expect(transition(db, item.id, 'draft', 'tester')).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('sets published_at on the first publish only', async () => {
    const item = await make({ status: 'scheduled' });
    const first = await transition(db, item.id, 'published', 'system');
    expect(first.publishedAt).toBeInstanceOf(Date);
    await transition(db, item.id, 'archived', 'owner');
    await transition(db, item.id, 'draft', 'owner');
    await transition(db, item.id, 'scheduled', 'owner');
    const again = await transition(db, item.id, 'published', 'system');
    expect(again.publishedAt?.getTime()).toBe(first.publishedAt?.getTime());
  });

  it('keeps only the 10 newest revisions', async () => {
    const item = await make();
    for (let i = 0; i < 6; i++) {
      await transition(db, item.id, 'in_review', 'tester');
      await transition(db, item.id, 'draft', 'tester');
    }
    const r = await db.query<{ min: number; max: number; n: string }>(
      'SELECT min(revision) min, max(revision) max, count(*) n FROM item_revisions WHERE item_id = $1', [item.id]);
    expect(Number(r.rows[0].n)).toBe(10);
    expect(r.rows[0].max).toBe(13);
    expect(r.rows[0].min).toBe(4);
  });

  it('refuses to schedule a Kids item without approval, and accepts it with approval', async () => {
    const item = await make({ worldId: kidsId, audience: 'kids', riskTier: 'kids' });
    await expect(transition(db, item.id, 'scheduled', 'system')).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect((await getItem(db, item.id))?.status).toBe('draft');
    const approved = await transition(db, item.id, 'scheduled', 'owner', 'looks good', { by: 'owner@example.com' });
    expect(approved.status).toBe('scheduled');
    expect(approved.approvedBy).toBe('owner@example.com');
    expect(approved.approvedAt).toBeInstanceOf(Date);
  });

  it('treats any item in a review-mode world as needing approval, even if labelled audience all', async () => {
    const inKids = await make({ worldId: kidsId, audience: 'all', riskTier: 'reflective' });
    await expect(transition(db, inKids.id, 'scheduled', 'system')).rejects.toBeInstanceOf(ApprovalRequiredError);
    await expect(make({ worldId: kidsId, audience: 'all', riskTier: 'reflective', status: 'scheduled' })).rejects.toBeInstanceOf(ApprovalRequiredError);
    const approved = await transition(db, inKids.id, 'scheduled', 'owner', undefined, { by: 'owner' });
    expect(approved.status).toBe('scheduled');
  });

  it('reports a missing item', async () => {
    await expect(transition(db, '00000000-0000-0000-0000-000000000000', 'archived', 'x')).rejects.toBeInstanceOf(NotFoundError);
  });
});
