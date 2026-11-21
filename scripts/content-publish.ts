// Automated content publish for the deploy receiver: imports new library items, refreshes stored hero
// images, syncs stored article topic links, then syncs stored visual-game rows, in one bundled process (built by `npm run content:publish:build`, shipped inside the release and run by
// deploy-receive.sh after the release passes its health gate, when the release carries the PUBLISH_CONTENT marker).
// It performs exactly the steps the owner used to run by hand — scripts/import-starter-content.ts
// (npm run content:import), scripts/update-hero-images.ts (npm run content:update-heroes) and
// scripts/update-game-items.ts (npm run content:update-games) — using the
// same library functions, the same production guard and the same output lines, so the workflow log reads the same.
// All steps are idempotent: existing rows are left alone and rows already current are untouched.
// Usage: node content-publish.mjs            (staging or a local database)
//        node content-publish.mjs --allow-production   (production database; the receiver passes this for prod only)
// The target database comes from DATABASE_URL in the environment (the receiver loads the target's env file).
// Owner authorization: standing instruction in chat, 16 November 2026 — daily publishing is automated with a
// reviewer agent as the quality gate; the owner runs no server commands. See docs/OPERATIONS.md.
import { getDb, getPool } from '../lib/db';
import { articleSchema, gameSchema, quizSchema } from '../lib/schemas';
import { readFolder } from '../lib/repository';
import { seedReference } from '../db/seed';
import { importLegacy } from '../lib/items/import-legacy';
import { updateHeroImages } from '../lib/items/update-heroes';
import { updateItemTopics } from '../lib/items/update-topics';
import { updateGameItems } from '../lib/items/update-games';
import { assertSafeImportTarget } from '../lib/items/import-guard';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local (always the case inside a release): rely on the real environment
}

const allowProduction = process.argv.includes('--allow-production');
const db = getDb();
try {
  const target = await db.query<{ db: string }>('SELECT current_database() AS db');
  const name = target.rows[0].db;
  assertSafeImportTarget(name, allowProduction);
  console.log(`Target database: ${name}`);

  const articles = readFolder('articles').map((a) => articleSchema.parse(a));
  const quizzes = readFolder('quizzes').map((q) => quizSchema.parse(q));
  const games = readFolder('games').map((g) => gameSchema.parse(g));

  await seedReference(db);
  const imported = await importLegacy(db, articles, quizzes, games);
  console.log(`Imported ${imported.items} items (${imported.answers} answers) from ${articles.length} articles, ${quizzes.length} quizzes and ${games.length} games.`);

  const heroes = await updateHeroImages(db, articles);
  console.log(`Hero images: ${heroes.updated} updated, ${heroes.unchanged} already current, ${heroes.missing} not in database.`);

  const topicLinks = await updateItemTopics(db, articles);
  console.log(`Topic links: ${topicLinks.added} added, ${topicLinks.unchanged} already current, ${topicLinks.missing} not in database.`);

  const gameSync = await updateGameItems(db, games);
  console.log(`Game items: ${gameSync.updated} updated, ${gameSync.unchanged} already current, ${gameSync.missing} not in database.`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
} finally {
  await getPool().end();
}
