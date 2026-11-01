// Imports the mock-up's worlds, topics, articles and quizzes into the database named by DATABASE_URL.
// Usage: npm run content:import            (staging or a local database)
//        npm run content:import -- --allow-production   (cut-over only, after a verified backup)
// Idempotent: existing rows are left alone.
import { getDb } from '../lib/db';
import { articleSchema, quizSchema } from '../lib/schemas';
import { readFolder } from '../lib/repository';
import { seedReference } from '../db/seed';
import { importLegacy } from '../lib/items/import-legacy';
import { assertSafeImportTarget } from '../lib/items/import-guard';

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
  await seedReference(db);
  const result = await importLegacy(db, articles, quizzes);
  console.log(`Imported ${result.items} items (${result.answers} answers) from ${articles.length} articles and ${quizzes.length} quizzes.`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
} finally {
  await (await import('../lib/db')).getPool().end();
}
