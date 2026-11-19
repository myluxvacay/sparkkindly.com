// @vitest-environment node
// updateGameItems: the guarded sync that pushes visual-game fixes from content/games into existing
// rows. The legacy import is insert-only, so without this a fixed game (the backdrop-ambiguity
// repairs of 18 Nov 2026) never reaches an imported row, and a memory game keeps its prompt as its
// listing summary. Only game rows change, and a second run is a no-op.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { readFolder } from '@/lib/repository';
import { gameSchema, type Game } from '@/lib/schemas';
import { seedReference } from '@/db/seed';
import { importLegacy, MEMORY_GAME_SUMMARY, gameBodyFor } from '@/lib/items/import-legacy';
import { updateGameItems } from '@/lib/items/update-games';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let obs: Game;
let mem: Game;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const games = readFolder('games').map((g) => gameSchema.parse(g));
  obs = games.find((g) => g.id === 'observation-030')!;
  mem = games.find((g) => g.id === 'memory-004')!;
  await importLegacy(db, [], [], [obs, mem]);
});
afterAll(async () => {
  await db.close();
});

const stored = async (slug: string) => {
  const r = await db.query<{ title: string; summary: string; body: unknown }>(
    "SELECT title, summary, body FROM items WHERE kind = 'game' AND slug = $1",
    [slug],
  );
  return r.rows[0];
};

describe('updateGameItems', () => {
  it('imports memory games with the neutral summary, never the prompt', async () => {
    const row = await stored('memory-004');
    expect(row.summary).toBe(MEMORY_GAME_SUMMARY);
    expect(row.summary).not.toBe(mem.prompt);
  });

  it('reports no change when stored rows already match the files', async () => {
    const result = await updateGameItems(db, [obs, mem]);
    expect(result).toEqual({ updated: 0, unchanged: 2, missing: 0 });
  });

  it('repairs a stale row written before the fix, and is idempotent', async () => {
    // Simulate the live pre-fix row: a body carrying the old answer and a stale summary.
    const staleBody = { ...gameBodyFor(obs), prompt: 'Which of these can you see in the farm? (old)' };
    await db.query("UPDATE items SET body = $1::jsonb, summary = $2 WHERE kind = 'game' AND slug = 'observation-030'", [
      JSON.stringify(staleBody),
      'stale summary',
    ]);
    const result = await updateGameItems(db, [obs]);
    expect(result.updated).toBe(1);
    const row = await stored('observation-030');
    expect(row.body).toEqual(gameBodyFor(obs));
    expect(row.summary).toBe(obs.prompt);
    const again = await updateGameItems(db, [obs]);
    expect(again).toEqual({ updated: 0, unchanged: 1, missing: 0 });
  });

  it('counts games that were never imported as missing', async () => {
    const games = readFolder('games').map((g) => gameSchema.parse(g));
    const other = games.find((g) => g.id !== 'observation-030' && g.id !== 'memory-004')!;
    const result = await updateGameItems(db, [other]);
    expect(result).toEqual({ updated: 0, unchanged: 0, missing: 1 });
  });
});
