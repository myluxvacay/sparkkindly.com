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

// The client key for rate limiting. IPv6 is always keyed by its /64 (one subscriber usually holds a whole /64, so
// per-address keys would let one actor rotate freely). IPv4 is the full address for sign-in links, or its /24 for the
// code limiter (v4Bits 24), where rotating neighbouring addresses must not add guesses. Anything malformed shares the
// single 'unknown' bucket, so junk cannot mint extra buckets.
export function clientPrefix(ip: string, v4Bits: 32 | 24 = 32): string {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(ip);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((o) => o > 255)) return 'unknown';
    return octets.slice(0, v4Bits === 24 ? 3 : 4).join('.');
  }
  if (!/^[0-9a-f:]{2,39}$/i.test(ip)) return 'unknown';
  const halves = ip.toLowerCase().split('::');
  if (halves.length > 2) return 'unknown';
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if ([...left, ...right].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return 'unknown';
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return 'unknown';
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...right];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

// The limits behind a sign-in link request (ruling, 1 November 2026; requestSignIn applies them):
// - client(ip): 10 requests an hour per client (full IPv4 address, IPv6 /64). The main control; every request spends
//   it and an unknown address spends nothing else.
// - While an allowed address has a still-valid pending link, a request re-sends that link, at most once per
//   5 minutes (resend). Only when there is no valid pending link (none yet, used, or expired after 15 minutes) is a new
//   one minted, under a hard cap of 6 per address in any hour, whoever asks (mint). No shared site-wide bucket.
// The browser gets the identical answer whatever happens. Residual risk: a flood can make a request send nothing,
// but only because a working link was emailed to that address within the last 5 minutes; it never blocks a link
// and never bypasses anything (the code and the allow-list still gate access). At most 6 + 12 emails in any hour
// reach one allowed address. Recovery path: edit ADMIN_EMAILS on the server and restart the service.
export function createSignInLimits(clock: () => number = Date.now) {
  const perClient = hourly(10, clock);
  const minted = new Map<string, number[]>();
  const lastResend = new Map<string, number>();
  const HOUR = 60 * 60_000;
  return {
    client: (ip: string): boolean => perClient(clientPrefix(ip)),
    mint(address: string): boolean {
      const now = clock();
      const recent = (minted.get(address) ?? []).filter((t) => now - t < HOUR);
      if (recent.length >= 6) {
        minted.set(address, recent);
        return false;
      }
      minted.set(address, [...recent, now]);
      return true;
    },
    resend(address: string): boolean {
      const now = clock();
      if (now - (lastResend.get(address) ?? -Infinity) < 5 * 60_000) return false;
      lastResend.set(address, now);
      return true;
    },
  };
}

// Link confirmations and authenticator codes: 20 an hour per IPv4 /24 or IPv6 /64. Each challenge (code-stage session)
// also dies after 5 wrong codes from any source (submitCode), and a new one needs a fresh emailed link.
export function createCodeLimits(clock: () => number = Date.now) {
  const perClient = hourly(20, clock);
  return (client: string): boolean => perClient(clientPrefix(client, 24));
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
