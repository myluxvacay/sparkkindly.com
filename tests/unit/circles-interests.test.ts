// @vitest-environment node
// Circle interests (plan 4C Task 1): the owner picks up to 10 topics and 5 worlds; ids must exist; members read them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { adult, circleOf, fixtures, join, type Fixtures } from '../helpers/circle-play';
import { closeCircle } from '@/lib/circles/owner';
import { getCircleInterests, setCircleInterests } from '@/lib/circles/interests';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let f: Fixtures;
const NOW = new Date('2026-11-05T12:00:00Z');

beforeAll(async () => {
  db = await newTestDb();
  f = await fixtures(db);
});
afterAll(async () => {
  await db.close();
});

describe('setCircleInterests', () => {
  it('the owner saves topics and worlds, and a save replaces the previous set', async () => {
    const owner = await adult(db);
    const { slug } = await circleOf(db, owner);
    expect(await setCircleInterests(db, owner, slug, { worldIds: [f.worlds.a], topicIds: [f.topics.x, f.topics.y] })).toBe('saved');
    expect(await getCircleInterests(db, owner, slug)).toEqual({ worldIds: [f.worlds.a], topicIds: [f.topics.x, f.topics.y].sort() });
    expect(await setCircleInterests(db, owner, slug, { worldIds: [f.worlds.b], topicIds: [] })).toBe('saved');
    expect(await getCircleInterests(db, owner, slug)).toEqual({ worldIds: [f.worlds.b], topicIds: [] });
  });

  it('a plain member and a stranger are not_owner and change nothing', async () => {
    const owner = await adult(db);
    const member = await adult(db);
    const stranger = await adult(db);
    const { slug } = await circleOf(db, owner);
    await join(db, slug, member);
    for (const who of [member, stranger, 'not-a-uuid']) {
      expect(await setCircleInterests(db, who, slug, { worldIds: [f.worlds.a], topicIds: [] })).toBe('not_owner');
    }
    expect(await getCircleInterests(db, owner, slug)).toEqual({ worldIds: [], topicIds: [] });
    expect(await getCircleInterests(db, member, slug)).toEqual({ worldIds: [], topicIds: [] });
    expect(await getCircleInterests(db, stranger, slug)).toBeNull();
  });

  it('unknown, duplicate, malformed or too many ids are invalid and change nothing', async () => {
    const owner = await adult(db);
    const { slug } = await circleOf(db, owner);
    await setCircleInterests(db, owner, slug, { worldIds: [f.worlds.a], topicIds: [] });
    const bad: { worldIds: unknown; topicIds: unknown }[] = [
      { worldIds: [999999], topicIds: [] },
      { worldIds: [], topicIds: [999999] },
      { worldIds: [f.worlds.a, f.worlds.a], topicIds: [] },
      { worldIds: ['1'], topicIds: [] },
      { worldIds: [1.5], topicIds: [] },
      { worldIds: null, topicIds: [] },
      { worldIds: [1, 2, 3, 4, 5, 6], topicIds: [] },
      { worldIds: [], topicIds: Array.from({ length: 11 }, (_, i) => i + 1) },
    ];
    for (const input of bad) expect(await setCircleInterests(db, owner, slug, input), JSON.stringify(input)).toBe('invalid');
    await db.query('UPDATE worlds SET enabled = false WHERE id = $1', [f.worlds.c]);
    expect(await setCircleInterests(db, owner, slug, { worldIds: [f.worlds.c], topicIds: [] })).toBe('invalid');
    await db.query('UPDATE worlds SET enabled = true WHERE id = $1', [f.worlds.c]);
    expect(await getCircleInterests(db, owner, slug)).toEqual({ worldIds: [f.worlds.a], topicIds: [] });
  });

  it('a closed circle is closed', async () => {
    const owner = await adult(db);
    const { slug } = await circleOf(db, owner);
    await closeCircle(db, owner, slug, NOW);
    expect(await setCircleInterests(db, owner, slug, { worldIds: [f.worlds.a], topicIds: [] })).toBe('closed');
  });
});
