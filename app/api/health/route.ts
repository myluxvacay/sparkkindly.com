import fs from 'node:fs';
import path from 'node:path';
import { getPool } from '@/lib/db';
import { getHealth, viewFor, isInternalHost } from '@/lib/health';
import { memoizeFor } from '@/lib/ttl-cache';

export const dynamic = 'force-dynamic';

// The deploy writes the git SHA into RELEASE at the release root (the service's working directory).
function readRelease(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'RELEASE'), 'utf8').trim() || 'dev';
  } catch {
    return 'dev';
  }
}

// A 5-second cache over the shared pool: a public endpoint must not open a database connection per request.
const checkDb = memoizeFor(5000, async () => {
  await getPool().query('SELECT 1');
});

export async function GET(request: Request) {
  const health = await getHealth({ env: process.env, checkDb, release: readRelease() });
  const internal = isInternalHost(request.headers.get('host'));
  return Response.json(viewFor(health, internal), { status: health.ok ? 200 : 503 });
}
