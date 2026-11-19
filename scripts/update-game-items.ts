// Refreshes stored visual-game rows from content/games in the database named by DATABASE_URL.
// Usage: npm run content:update-games            (staging or a local database)
//        npm run content:update-games -- --allow-production   (production, after a verified backup)
// The legacy import is insert-only, so game fixes in the content files need this explicit sync;
// it touches only kind = 'game' rows whose stored form differs from the files (see
// lib/items/update-games.ts).
import { getDb } from '../lib/db';
import { gameSchema } from '../lib/schemas';
import { readFolder } from '../lib/repository';
import { assertSafeImportTarget } from '../lib/items/import-guard';
import { updateGameItems } from '../lib/items/update-games';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: rely on the real environment
}

const db = getDb();
try {
  const target = await db.query<{ db: string }>('SELECT current_database() AS db');
  const name = target.rows[0].db;
  assertSafeImportTarget(name, process.argv.includes('--allow-production'));
  console.log(`Target database: ${name}`);

  const games = readFolder('games').map((g) => gameSchema.parse(g));
  const result = await updateGameItems(db, games);
  console.log(`Game items: ${result.updated} updated, ${result.unchanged} already current, ${result.missing} not in database.`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
} finally {
  await (await import('../lib/db')).getPool().end();
}
