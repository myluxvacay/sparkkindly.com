import { getDb } from '@/lib/db';
import { runActRequest } from '@/lib/family-hub/web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ circleId: string }> }) {
  const { circleId } = await params;
  return runActRequest(request, { db: getDb(), now: new Date() }, circleId);
}
