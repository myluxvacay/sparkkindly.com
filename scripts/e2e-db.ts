// Starts an in-process PostgreSQL (PGlite) on 127.0.0.1:54329 for the Playwright suite: migrated, seeded and loaded
// with the starter content. It never reads DATABASE_URL, so it cannot touch a real database.
// Verified by: running it, then five parallel queries against it (see the Project 1B plan, Task 1).
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { fromPglite } from '../tests/helpers/test-db';
import { migrate } from '../db/migrate.mjs';
import { seedReference } from '../db/seed';
import { importLegacy } from '../lib/items/import-legacy';
import { articleSchema, quizSchema } from '../lib/schemas';
import { readFolder } from '../lib/repository';

const PORT = 54329;
const pg = await PGlite.create();
const db = fromPglite(pg);
await migrate(db, 'db/migrations');
await seedReference(db);
const articles = readFolder('articles').map((a) => articleSchema.parse(a));
const quizzes = readFolder('quizzes').map((q) => quizSchema.parse(q));
const result = await importLegacy(db, articles, quizzes);

const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1', maxConnections: 10 });
await server.start();
console.log(`e2e db ready on ${PORT}: ${result.items} items, ${result.answers} answers`);

const stop = async () => {
  await server.stop();
  await pg.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
