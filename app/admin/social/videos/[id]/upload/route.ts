import { getDb } from '@/lib/db';
import { handleVideoUpload } from '@/lib/social/video/upload-route';

export const dynamic = 'force-dynamic';

// POST /admin/social/videos/<id>/upload/  the finished video or its caption file (admin session, CSRF header; plan 5B).
// There is no GET: uploaded media is never served.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleVideoUpload(request, { db: getDb(), env: process.env, now: new Date(), jobId: id });
}
