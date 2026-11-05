import { getDb } from '@/lib/db';
import { addChildRequest } from '@/lib/circles/web';

export const dynamic = 'force-dynamic';

// The flags, Origin, adult context and membership are checked inside addChildRequest.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return addChildRequest(request, { db: getDb(), now: new Date() }, (await params).slug);
}
