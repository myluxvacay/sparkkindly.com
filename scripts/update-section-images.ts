// Refreshes stored article section images from content/articles in the database named by DATABASE_URL.
// Usage: npm run content:update-section-images            (staging or a local database)
//        npm run content:update-section-images -- --allow-production   (production, after a verified backup)
// The legacy import is insert-only, so section images need this explicit sync; it touches only the
// `image` key of stored body sections.
import { getDb } from '../lib/db';
import { articleSchema } from '../lib/schemas';
import { readFolder } from '../lib/repository';
import { assertSafeImportTarget } from '../lib/items/import-guard';
import { updateSectionImages } from '../lib/items/update-section-images';

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
  const result = await updateSectionImages(db, articles);
  console.log(
    `Section images: ${result.updated} updated, ${result.unchanged} already current, ${result.missing} not in database, ${result.skipped} skipped.`,
  );
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
} finally {
  await (await import('../lib/db')).getPool().end();
}
