// Creates an agent and prints its key ONCE. The key is not stored anywhere recoverable: save it straight away.
// Usage: npm run agent:create -- <name> [--world <slug>]   (no --world makes the master agent)
// Reads DATABASE_URL (from .env.local or the environment): point it at the database the key is for.
import { getDb, getPool } from '../lib/db';
import { createAgent } from '../lib/agents/admin';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: rely on the real environment
}

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--world');
const worldIndex = args.indexOf('--world');
const world = worldIndex >= 0 ? args[worldIndex + 1] : null;

if (!name || (worldIndex >= 0 && !world)) {
  console.error('Usage: npm run agent:create -- <name> [--world <slug>]');
  process.exit(2);
}

try {
  const db = getDb();
  const target = await db.query<{ db: string }>('SELECT current_database() AS db');
  const { id, key } = await createAgent(db, name, world);
  console.log(`Created agent #${id} "${name}" (${world ? `world: ${world}` : 'master'}) in database ${target.rows[0].db}.`);
  console.log('Key (shown once, send it as the X-Agent-Key header):');
  console.log(key);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
} finally {
  await getPool().end();
}
