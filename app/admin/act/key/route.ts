import { getDb } from '@/lib/db';
import { showAgentKey } from '@/lib/admin/act';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return showAgentKey(request, { db: getDb(), env: process.env, now: new Date() });
}
