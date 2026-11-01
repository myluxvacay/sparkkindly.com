import { getDb } from '@/lib/db';
import { anonymousScope } from '@/lib/public/scope';
import { submitReport, checkReportRate } from '@/lib/reports/submit';

export const dynamic = 'force-dynamic';

// The form page lives at /report/<world>/<slug>/ and posts here. (A route.ts cannot share a folder with a page.tsx.)
const see = (status: number, location: string, extra: Record<string, string> = {}) =>
  new Response(null, { status, headers: { Location: location, ...extra } });

export async function POST(request: Request, { params }: { params: Promise<{ world: string; slug: string }> }) {
  // A browser always sends Origin on a cross-site POST; when present it must be this host.
  const origin = request.headers.get('origin');
  if (origin !== null) {
    let same = false;
    try {
      same = new URL(origin).host === request.headers.get('host');
    } catch {
      same = false;
    }
    if (!same) return new Response('Forbidden', { status: 403 });
  }
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
    return new Response('Unsupported media type', { status: 415 });
  }
  // Caddy sets X-Forwarded-For and the app listens on loopback only, so the first entry is the real client.
  const client = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const rate = checkReportRate(client);
  if (!rate.ok) return new Response('Too many reports. Please try again later.', { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } });

  const { world, slug } = await params;
  const form = await request.formData();
  const result = await submitReport(getDb(), anonymousScope(), {
    world,
    slug,
    reason: form.get('reason'),
    message: form.get('message'),
    website: form.get('website'),
  });
  if (result.status === 'not_found') return new Response('Not found', { status: 404 });
  const back = `/report/${encodeURIComponent(world)}/${encodeURIComponent(slug)}/`;
  return see(303, `${back}?${result.status === 'stored' ? 'sent=1' : 'error=1'}`);
}
