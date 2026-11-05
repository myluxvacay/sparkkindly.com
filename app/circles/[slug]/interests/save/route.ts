import { getDb } from '@/lib/db';
import { saveCircleInterestsRequest } from '@/lib/circles/play-web';

export const dynamic = 'force-dynamic';

// The flags, Origin, adult context, membership and the owner check are inside saveCircleInterestsRequest.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return saveCircleInterestsRequest(request, { db: getDb(), now: new Date() }, (await params).slug);
}
