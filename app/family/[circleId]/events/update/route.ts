import { getDb } from '@/lib/db';
import { updateEventRequest } from '@/lib/family-hub/web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ circleId: string }> }) {
  const { circleId } = await params;
  return updateEventRequest(request, { db: getDb(), now: new Date() }, circleId);
}
