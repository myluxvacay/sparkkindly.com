// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import {
  addMeToo, countRequestsByStatus, createRequest, getRequest, listPublicRequests, listRequestsByStatus, setRequestStatus,
} from '@/lib/requests/repo';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);
const NOW = new Date('2026-11-23T12:00:00Z');

beforeAll(async () => { db = await newTestDb(); });
afterAll(async () => { await db.close(); });

describe('printable requests repo', () => {
  it('a new request is pending and invisible on the public shelf', async () => {
    const r = await createRequest(db, { categoryTopic: 'printables-counting-maths', ageTopic: 'ages-5-8', requestText: 'A counting sheet with dinosaurs', submitterHash: HASH });
    expect(r.status).toBe('pending');
    expect(r.meTooCount).toBe(0);
    expect(await listPublicRequests(db)).toHaveLength(0);
    expect(await listRequestsByStatus(db, 'pending')).toHaveLength(1);
    expect((await countRequestsByStatus(db)).pending).toBe(1);
  });

  it('approval puts it on the shelf; me-too counts once per visitor', async () => {
    const [pending] = await listRequestsByStatus(db, 'pending');
    expect(await setRequestStatus(db, pending.id, ['pending'], 'approved', null, NOW)).toBe(true);
    // A second decision from the same starting status is refused, not overwritten.
    expect(await setRequestStatus(db, pending.id, ['pending'], 'approved', null, NOW)).toBe(false);
    const shelf = await listPublicRequests(db);
    expect(shelf.map((r) => r.id)).toEqual([pending.id]);

    expect(await addMeToo(db, pending.id, HASH)).toMatchObject({ counted: true, meTooCount: 1 });
    expect(await addMeToo(db, pending.id, HASH)).toMatchObject({ counted: false, meTooCount: 1 });
    expect(await addMeToo(db, pending.id, HASH2)).toMatchObject({ counted: true, meTooCount: 2 });
    expect((await getRequest(db, pending.id))?.meTooCount).toBe(2);
  });

  it('votes do not land on pending or declined requests; created requires and keeps its link', async () => {
    const r = await createRequest(db, { categoryTopic: 'printables-mazes', ageTopic: 'ages-6-10', requestText: 'A maze shaped like a castle', submitterHash: HASH });
    expect(await addMeToo(db, r.id, HASH)).toMatchObject({ counted: false, meTooCount: 0 });
    expect(await setRequestStatus(db, r.id, ['pending', 'approved'], 'created', '/printables/paper-aeroplane-classic-dart/', NOW)).toBe(true);
    const created = await getRequest(db, r.id);
    expect(created?.status).toBe('created');
    expect(created?.createdUrl).toBe('/printables/paper-aeroplane-classic-dart/');
    const shelf = await listPublicRequests(db);
    // Waiting requests list before made ones.
    expect(shelf[shelf.length - 1].id).toBe(r.id);
  });

  it('the table itself refuses a created request with no link', async () => {
    await expect(
      db.query("INSERT INTO printable_requests (category_topic, age_topic, request_text, status, submitter_hash) VALUES ('printables-mazes', 'ages-5-8', 'x', 'created', $1)", [HASH]),
    ).rejects.toThrow();
  });
});
