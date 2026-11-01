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

// The network a client address belongs to, for rate limiting: IPv4 by /24, IPv6 by /64 (one subscriber usually holds
// a whole /64, so per-address keys would let one actor rotate freely). Anything unparseable is its own key.
export function clientPrefix(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}`;
  if (!/^[0-9a-f:]+$/i.test(ip) || !ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

// Sign-in link requests, keyed by client network (clientPrefix). The per-network limit (10 an hour) is the main
// control and is spent by every request. An allow-listed address also spends 3 an hour per (network, address).
// There is deliberately no shared site-wide ceiling: anything every client spends together can be drained by one
// actor to lock the owner out. Unknown addresses touch only the per-network limit.
// ponytail: the owner's inbox can receive at most 3 links an hour from each network an attacker controls; if that is
// ever abused, add a per-address cap that re-sends the pending link instead of minting new ones.
export function createSignInLimits(clock: () => number = Date.now) {
  const perClient = hourly(10, clock);
  const perPair = hourly(3, clock);
  return (client: string, email: string, allowed: boolean): boolean => {
    const net = clientPrefix(client);
    if (!perClient(net)) return false;
    return !allowed || perPair(`${net}|${email.trim().toLowerCase()}`);
  };
}

// Link confirmations and authenticator codes: 20 an hour per client network (each session also dies after 5 wrong
// codes, and a session needs a fresh emailed link).
export function createCodeLimits(clock: () => number = Date.now) {
  const perClient = hourly(20, clock);
  return (client: string): boolean => perClient(clientPrefix(client));
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
