import { readCapped } from '@/lib/agents/http';
import { getDb } from '@/lib/db';
import { submitContactMessage, checkContactRate } from '@/lib/contact/submit';
import { notifyOwnerOfContact } from '@/lib/contact/notify';

export const dynamic = 'force-dynamic';

// The form lives on /contact/ and posts here. (A route.ts cannot share a folder with a page.tsx.) A message is at
// most 2000 characters plus a name, an email and a topic; 16 KB leaves room for encoding and the honeypot field.
const MAX_FORM_BYTES = 16 * 1024;
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
  const rate = checkContactRate(client);
  if (!rate.ok) return new Response('Too many messages. Please try again later.', { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } });

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FORM_BYTES) return new Response('Payload too large', { status: 413 });
  const bytes = await readCapped(request, MAX_FORM_BYTES);
  if (!bytes) return new Response('Payload too large', { status: 413 });
  const form = new URLSearchParams(new TextDecoder().decode(bytes));

  const result = await submitContactMessage(getDb(), {
    name: form.get('name'),
    email: form.get('email'),
    topic: form.get('topic'),
    message: form.get('message'),
    website: form.get('website'),
  });
  if (result.status === 'invalid') return see(303, '/contact/?error=1#result');
  // A honeypot drop answers exactly like a stored message but writes nothing and notifies nobody.
  if (result.status === 'stored') await notifyOwnerOfContact(result.contact);
  return see(303, '/contact/?sent=1#result');
}
