import { readCapped } from '@/lib/agents/http';
import { getDb } from '@/lib/db';
import { checkRequestRate, submitPrintableRequest, visitorHash } from '@/lib/requests/submit';

export const dynamic = 'force-dynamic';

// The Request-a-Creation form lives on /printables/request/ and posts here (a route.ts cannot share
// a folder with a page.tsx). Modelled on the contact submit route: same-origin check, per-client and
// overall rate limits, a capped body, and a honeypot drop that answers exactly like a stored
// request. A request is at most 280 characters plus two short selects; 8 KB leaves room for
// encoding and the honeypot field.
const MAX_FORM_BYTES = 8 * 1024;
const see = (status: number, location: string) => new Response(null, { status, headers: { Location: location } });

export async function POST(request: Request) {
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
  const rate = checkRequestRate.submit(client);
  if (!rate.ok) return new Response('Too many requests. Please try again later.', { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } });

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FORM_BYTES) return new Response('Payload too large', { status: 413 });
  const bytes = await readCapped(request, MAX_FORM_BYTES);
  if (!bytes) return new Response('Payload too large', { status: 413 });
  const form = new URLSearchParams(new TextDecoder().decode(bytes));

  const result = await submitPrintableRequest(
    getDb(),
    { category: form.get('category'), age: form.get('age'), text: form.get('text'), website: form.get('website') },
    visitorHash(client),
  );
  if (result.status === 'invalid') return see(303, '/printables/request/?error=1#result');
  // A honeypot drop answers exactly like a stored request but writes nothing.
  return see(303, '/printables/request/?sent=1#result');
}
