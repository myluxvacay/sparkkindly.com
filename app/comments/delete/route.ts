import { getDb } from '@/lib/db';
import { deleteCommentRequest } from '@/lib/comments/web';

export const dynamic = 'force-dynamic';

// The flags, Origin and adult context are checked inside deleteCommentRequest.
export async function POST(request: Request) {
  return deleteCommentRequest(request, { db: getDb(), now: new Date() });
}
