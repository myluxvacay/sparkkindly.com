import { leaderboardEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { saveLeaderboardRequest } from '@/lib/accounts/leaderboard-web';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!leaderboardEnabled()) return new Response('Not found', { status: 404 });
  return saveLeaderboardRequest(request, { db: getDb(), now: new Date() });
}
