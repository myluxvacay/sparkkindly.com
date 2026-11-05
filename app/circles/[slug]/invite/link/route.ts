import { getDb } from '@/lib/db';
import { createLinkRequest } from '@/lib/circles/invite-web';

export const dynamic = 'force-dynamic';

// The flags, Origin, adult context and membership are checked inside createLinkRequest.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return createLinkRequest(request, { db: getDb(), now: new Date() }, (await params).slug);
}
