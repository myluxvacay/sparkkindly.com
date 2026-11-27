import { getDb } from '@/lib/db';
import { completionDecideRequest } from '@/lib/family-hub/web-loops';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ circleId: string }> }) {
  const { circleId } = await params;
  return completionDecideRequest(request, { db: getDb(), now: new Date() }, circleId);
}
