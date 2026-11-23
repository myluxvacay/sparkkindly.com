import { readCapped } from '@/lib/agents/http';
import { getDb } from '@/lib/db';
import { addMeToo } from '@/lib/requests/repo';
import { checkRequestRate, visitorHash } from '@/lib/requests/submit';

export const dynamic = 'force-dynamic';

// A "Me too" vote from the Fresh Requests shelf. Anonymous by design: the voter is a one-way hash
// of the client network prefix and browser family — no cookie, no browser storage, no account — and
// the votes table's primary key makes a second vote from the same visitor a no-op. Same-origin and
// rate-limit defences mirror the request submit route.
const MAX_FORM_BYTES = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const see = (status: number, location: string) => new Response(null, { status, headers: { Location: location } });

export async function POST(request: Request) {
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
  const client = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const rate = checkRequestRate.vote(client);
  if (!rate.ok) return new Response('Too many votes. Please try again later.', { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } });

  const bytes = await readCapped(request, MAX_FORM_BYTES);
  if (!bytes) return new Response('Payload too large', { status: 413 });
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  const id = form.get('id') ?? '';
  if (!UUID.test(id)) return see(303, '/printables/fresh-requests/');
  const voter = visitorHash(client, request.headers.get('user-agent') ?? '');
  await addMeToo(getDb(), id, voter);
  return see(303, `/printables/fresh-requests/?voted=1#request-${id}`);
}
