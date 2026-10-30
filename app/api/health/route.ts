import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { getHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

// The deploy writes the git SHA into RELEASE at the release root (the service's working directory).
function readRelease(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'RELEASE'), 'utf8').trim() || 'dev';
  } catch {
    return 'dev';
  }
}

async function checkDb(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000 });
  try {
    await pool.query('SELECT 1');
  } finally {
    await pool.end();
  }
}

export async function GET() {
  const health = await getHealth({ env: process.env, checkDb, release: readRelease() });
  return Response.json(health, { status: health.ok ? 200 : 503 });
}
