import { getDb } from '@/lib/db';
import { exitKidViewRequest } from '@/lib/family-hub/web-kid';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ circleId: string; kidProfileId: string }> }) {
  const { circleId, kidProfileId } = await params;
  return exitKidViewRequest(request, { db: getDb(), now: new Date() }, circleId, kidProfileId);
}
