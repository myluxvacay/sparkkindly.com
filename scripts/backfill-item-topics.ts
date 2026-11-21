// Syncs stored article topic links from content/articles in the database named by DATABASE_URL.
// Usage: npm run content:update-topics            (staging or a local database)
//        npm run content:update-topics -- --allow-production   (production, after a verified backup)
// The legacy import is insert-only and drops tags that had no topic row at import time, so topic
// links for existing articles need this explicit sync when the topic list grows (migration 043);
// it touches only item_topics rows, and only by adding links.
import { getDb } from '../lib/db';
import { articleSchema } from '../lib/schemas';
import { readFolder } from '../lib/repository';
import { assertSafeImportTarget } from '../lib/items/import-guard';
import { updateItemTopics } from '../lib/items/update-topics';

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
  const result = await updateItemTopics(db, articles);
  console.log(`Topic links: ${result.added} added, ${result.unchanged} already current, ${result.missing} not in database.`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
} finally {
  await (await import('../lib/db')).getPool().end();
}
