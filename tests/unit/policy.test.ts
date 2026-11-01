// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createItem } from '@/lib/items/repo';
import { decideStatus, nextSlot } from '@/lib/items/policy';

const NOW = new Date('2026-10-31T12:00:00Z');
const SLOT = new Date('2026-11-01T06:00:00Z');
const input = (over: Partial<Parameters<typeof decideStatus>[0]> = {}): Parameters<typeof decideStatus>[0] => ({
  gatesOk: true, audience: 'all', riskTier: 'reflective', worldApprovalMode: 'auto', publishAt: null, now: NOW, slot: SLOT, ...over,
});

describe('decideStatus', () => {
  it('failed gates stay draft', () => {
    const r = decideStatus(input({ gatesOk: false }));
    expect(r.status).toBe('draft');
    expect(r.publishAt).toBeNull();
  });

  it('a Kids-tier item goes to in_review even when the world is auto', () => {
    expect(decideStatus(input({ riskTier: 'kids', worldApprovalMode: 'auto' })).status).toBe('in_review');
  });

  it('audience kids goes to in_review whatever the tier', () => {
    expect(decideStatus(input({ audience: 'kids', riskTier: 'reflective' })).status).toBe('in_review');
  });

  it('a review-mode world sends everything to in_review', () => {
    expect(decideStatus(input({ worldApprovalMode: 'review' })).status).toBe('in_review');
  });

  it('an in_review result carries no publish time; the slot is chosen when the owner approves', () => {
    expect(decideStatus(input({ riskTier: 'kids', publishAt: new Date('2026-12-01T06:00:00Z') })).publishAt).toBeNull();
  });

  it('an auto world with passing gates schedules into the next free slot', () => {
    const r = decideStatus(input());
    expect(r.status).toBe('scheduled');
    expect(r.publishAt).toEqual(SLOT);
  });

  it('keeps an explicit future publish time', () => {
    const later = new Date('2026-11-09T06:00:00Z');
    expect(decideStatus(input({ publishAt: later })).publishAt).toEqual(later);
  });

  it('bumps an explicit publish time in the past to the next slot', () => {
    expect(decideStatus(input({ publishAt: new Date('2026-10-01T06:00:00Z') })).publishAt).toEqual(SLOT);
  });

  it('the excluded tier is never scheduled and says why', () => {
    const r = decideStatus(input({ riskTier: 'excluded' }));
    expect(r.status).toBe('draft');
    expect(r.reason).toMatch(/excluded/i);
  });

  it('always explains the decision', () => {
    for (const over of [{ gatesOk: false }, { riskTier: 'kids' as const }, { worldApprovalMode: 'review' as const }, {}]) {
      expect(decideStatus(input(over)).reason.length).toBeGreaterThan(5);
    }
  });
});

describe('nextSlot', () => {
  type TestDb = Awaited<ReturnType<typeof newTestDb>>;
  let db: TestDb;
  let worldId: number;
  let otherWorldId: number;
  let n = 0;
  beforeAll(async () => {
    db = await newTestDb();
    await seedReference(db);
    const w = (await db.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds')).rows;
    worldId = w.find((x) => x.slug === 'play')!.id;
    otherWorldId = w.find((x) => x.slug === 'grow')!.id;
  });
  afterAll(async () => {
    await db.close();
  });
  const schedule = (world: number, at: string, status: 'scheduled' | 'published' | 'draft' = 'scheduled') =>
    createItem(db, { worldId: world, kind: 'article', slug: `s-${++n}`, title: 't', summary: 'A summary', body: {}, audience: 'all', createdBy: 't', riskTier: 'reflective', status, publishAt: new Date(at) });

  it('returns tomorrow 06:00 UTC for an empty world when it is already past 06:00 today', async () => {
    expect(await nextSlot(db, worldId, NOW)).toEqual(new Date('2026-11-01T06:00:00Z'));
  });

  it('returns today 06:00 UTC when it is earlier than that', async () => {
    expect(await nextSlot(db, worldId, new Date('2026-10-31T04:00:00Z'))).toEqual(new Date('2026-10-31T06:00:00Z'));
  });

  it('returns the day after the latest scheduled item', async () => {
    await schedule(worldId, '2026-11-03T06:00:00Z');
    expect(await nextSlot(db, worldId, NOW)).toEqual(new Date('2026-11-04T06:00:00Z'));
  });

  it('ignores other worlds and items that are not scheduled', async () => {
    await schedule(otherWorldId, '2026-12-25T06:00:00Z');
    await schedule(worldId, '2026-12-01T06:00:00Z', 'draft');
    expect(await nextSlot(db, worldId, NOW)).toEqual(new Date('2026-11-04T06:00:00Z'));
  });
});
