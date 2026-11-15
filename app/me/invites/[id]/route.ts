import { circlesEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { answerAccountInviteRequest } from '@/lib/circles/invite-web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!circlesEnabled()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  return answerAccountInviteRequest(request, { db: getDb(), now: new Date() }, id);
}
