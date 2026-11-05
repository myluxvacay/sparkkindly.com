import { circlesEnabled } from '@/lib/config';
import { inviteImage } from '@/lib/public/template-image';

export const dynamic = 'force-dynamic';

// The Open Graph image of every invite page: the same branded card for all, no personal data.
export async function GET() {
  if (!circlesEnabled()) return new Response('Not found', { status: 404 });
  return inviteImage();
}
