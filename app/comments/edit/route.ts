import { getDb } from '@/lib/db';
import { editCommentRequest } from '@/lib/comments/web';

export const dynamic = 'force-dynamic';

// The flags, Origin and adult context are checked inside editCommentRequest.
export async function POST(request: Request) {
  return editCommentRequest(request, { db: getDb(), now: new Date() });
}
