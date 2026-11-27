import { getDb } from '@/lib/db';
import { acceptInviteRequest } from '@/lib/family-hub/web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return acceptInviteRequest(request, { db: getDb(), now: new Date() }, token);
}
