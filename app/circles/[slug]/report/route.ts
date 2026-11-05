import { getDb } from '@/lib/db';
import { reportCircleRequest } from '@/lib/circles/reports';

export const dynamic = 'force-dynamic';

// The flags, Origin, adult context, membership and allowance are checked inside reportCircleRequest.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return reportCircleRequest(request, { db: getDb(), now: new Date() }, (await params).slug);
}
