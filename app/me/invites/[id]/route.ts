import { circlesEnabled, leaderboardEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { answerAccountInviteRequest } from '@/lib/circles/invite-web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Account-kind invites exist only as part of the leaderboard feature (migration 036), so the leaderboard
  // flag is a kill switch for answering them too, not just for the board itself (review SF-1).
  if (!circlesEnabled() || !leaderboardEnabled()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  return answerAccountInviteRequest(request, { db: getDb(), now: new Date() }, id);
}
