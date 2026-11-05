import { getDb } from '@/lib/db';
import { postCommentRequest } from '@/lib/comments/web';

export const dynamic = 'force-dynamic';

// The flags, Origin and adult context are checked inside postCommentRequest.
export async function POST(request: Request) {
  return postCommentRequest(request, { db: getDb(), now: new Date() });
}
