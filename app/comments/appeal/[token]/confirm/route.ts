import { getDb } from '@/lib/db';
import { fileAppealRequest } from '@/lib/comments/appeals';

export const dynamic = 'force-dynamic';

// The flags, Origin and the per-address limit are checked inside fileAppealRequest; the token names the comment.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return fileAppealRequest(request, { db: getDb(), env: process.env, now: new Date() }, (await params).token);
}
