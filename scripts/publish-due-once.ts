// Runs the publish-due job once against the database named by DATABASE_URL, the same function the worker will call on a
// schedule. Useful for checking a deployment by hand: npm run job:publish-due
import { getDb, getPool } from '../lib/db';
import { publishDue } from '../lib/jobs/publish-due';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: rely on the real environment
}

try {
  const db = getDb();
  const name = (await db.query<{ db: string }>('SELECT current_database() AS db')).rows[0].db;
  const { published, held, failed } = await publishDue(db, new Date());
  console.log(`Database ${name}: published ${published.length} item(s), sent ${held.length} back to review.`);
  for (const id of published) console.log(`  published ${id}`);
  for (const id of held) console.log(`  held for review ${id}`);
  for (const id of failed) console.log(`  failed (left scheduled) ${id}`);
  if (failed.length) process.exitCode = 1;
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
} finally {
  await getPool().end();
}
