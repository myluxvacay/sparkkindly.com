import { readCapped } from '@/lib/agents/http';
import { createLimiter } from '@/lib/agents/rate-limit';

// Request checks shared by every admin POST. No Next imports, so they test in isolation.

// Strict same-origin: a browser sends Origin on every POST, so an admin POST without one, or from another host, is
// refused. (The public report form tolerates a missing Origin; admin does not.)
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Caddy sets X-Forwarded-For and the app listens on loopback only, so the first entry is the real client.
export const clientKey = (request: Request): string =>
  request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';

// Where to send the browser after an action: only a path inside /admin/, never another site.
export function safeReturn(raw: unknown): string {
  if (typeof raw !== 'string') return '/admin/';
  if (!/^\/admin\/[A-Za-z0-9/_\-?=&.%]*$/.test(raw) || raw.includes('//')) return '/admin/';
  return raw;
}

// createLimiter counts per minute; a clock running 60x slow turns "n per minute" into "n per hour".
const hourly = (perHour: number, clock: () => number) => createLimiter({ perMinute: perHour, now: () => clock() / 60 });

// Sign-in link requests. The per-client limit (10 an hour) is the main control and is spent by every request.
// Only an allow-listed address spends more: 3 an hour per (client, address), then a site-wide ceiling of 100 links an
// hour that caps mail volume. Unknown addresses never touch those, and one client's flood never spends another
// client's (client, address) allowance, so nobody can lock the owner out by submitting the owner's address.
// ponytail: a distributed attacker with 100+ addresses could still spend the site-wide ceiling for an hour; the
// trade is a bounded inbox and MailerSend quota. Raise or drop the ceiling if that ever happens.
export function createSignInLimits(clock: () => number = Date.now) {
  const perClient = hourly(10, clock);
  const perPair = hourly(3, clock);
  const overall = hourly(100, clock);
  return (client: string, email: string, allowed: boolean): boolean => {
    if (!perClient(client)) return false;
    if (!allowed) return true;
    return perPair(`${client}\n${email.trim().toLowerCase()}`) && overall('all');
  };
}

// Link confirmations and authenticator codes: 20 an hour per client (each session also dies after 5 wrong codes).
export function createCodeLimits(clock: () => number = Date.now) {
  const perClient = hourly(20, clock);
  return (client: string): boolean => perClient(client);
}

// One instance of each per process, shared across route modules.
const shared = globalThis as unknown as {
  __sparkSignInLimits?: ReturnType<typeof createSignInLimits>;
  __sparkCodeLimits?: ReturnType<typeof createCodeLimits>;
};
export const signInLimits = (shared.__sparkSignInLimits ??= createSignInLimits());
export const codeLimits = (shared.__sparkCodeLimits ??= createCodeLimits());

// The admin session cookie: host-only (__Host-), HttpOnly, Secure, SameSite=Strict, so no other site or subdomain
// can send or set it. maxAge 0 clears it.
export const ADMIN_COOKIE = '__Host-sk_admin';

export const sessionCookie = (value: string, maxAgeSeconds: number): string =>
  `${ADMIN_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;

export function readCookie(request: Request, name = ADMIN_COOKIE): string {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

// A 303 redirect (the browser follows it with a GET), with optional cookie.
export function seeOther(location: string, cookie?: string): Response {
  const headers: Record<string, string> = { Location: location, 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 303, headers });
}

// A urlencoded form body of at most `max` bytes, or null.
export async function readForm(request: Request, max = 8192): Promise<URLSearchParams | null> {
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return null;
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  const bytes = await readCapped(request, max);
  if (!bytes) return null;
  return new URLSearchParams(new TextDecoder().decode(bytes));
}
