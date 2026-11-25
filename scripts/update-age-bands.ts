// Syncs stored age-band topic links from the content files' ageBands fields in the database
// named by DATABASE_URL. Usage: npm run content:update-age-bands   (staging or a local database)
//        npm run content:update-age-bands -- --allow-production   (production, after a verified backup)
// The legacy import is insert-only, so band links for existing items need this explicit sync
// when band assignments land (24 Nov 2026); it touches only item_topics rows, and only by
// adding links. The deploy receiver runs the same step inside content-publish.
import { getDb } from '../lib/db';
import { articleSchema, gameSchema, quizSchema } from '../lib/schemas';
import { readFolder } from '../lib/repository';
import { assertSafeImportTarget } from '../lib/items/import-guard';
import { updateAgeBandTopics } from '../lib/items/update-age-bands';

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

  const articles = readFolder('articles').map((a) => articleSchema.parse(a));
  const quizzes = readFolder('quizzes').map((q) => quizSchema.parse(q));
  const games = readFolder('games').map((g) => gameSchema.parse(g));
  const result = await updateAgeBandTopics(db, articles, quizzes, games);
  console.log(`Age-band links: ${result.added} added, ${result.unchanged} already current, ${result.missing} not in database.`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
} finally {
  await (await import('../lib/db')).getPool().end();
}
