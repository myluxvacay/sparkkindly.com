import { circlesEnabled, leaderboardEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { leaderInviteRequest } from '@/lib/circles/invite-web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  if (!leaderboardEnabled() || !circlesEnabled()) return new Response('Not found', { status: 404 });
  const { key } = await params;
  return leaderInviteRequest(request, { db: getDb(), now: new Date() }, key);
}
