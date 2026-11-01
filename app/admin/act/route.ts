import { getDb } from '@/lib/db';
import { handleAdminAction } from '@/lib/admin/act';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleAdminAction(request, { db: getDb(), env: process.env, now: new Date() });
}
