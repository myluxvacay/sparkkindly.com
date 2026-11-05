// The one-time invite link cookie (plan 4B, review fix 5). A new link token comes back to its maker once, through this
// short-lived HttpOnly cookie read by the circle page; the proxy (proxy.ts) clears it on the first plain GET of a circle
// page that carries it, and signing out clears it too. No imports, so the proxy bundle stays small.
// Verified by tests/unit/circles-invite-guard.test.ts.
export const INVITE_COOKIE = '__Host-sk_invite';

export const flashCookie = (token: string) => `${INVITE_COOKIE}=${token}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`;
export const CLEAR_FLASH = `${INVITE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

const CIRCLE_PAGE = /^\/circles\/[a-z0-9]{10}\/?$/;
const PREFETCH = ['next-router-prefetch', 'sec-purpose', 'purpose', 'x-moz'];

// True for a plain (not prefetch) GET of /circles/<slug>/ that carries the cookie.
export function clearsFlash(r: { method: string; pathname: string; headers: Headers }): boolean {
  if (r.method !== 'GET' || !CIRCLE_PAGE.test(r.pathname)) return false;
  if (PREFETCH.some((h) => (h === 'next-router-prefetch' ? r.headers.has(h) : r.headers.get(h)?.toLowerCase().includes('prefetch')))) {
    return false;
  }
  return (r.headers.get('cookie') ?? '').split(';').some((c) => c.trim().startsWith(`${INVITE_COOKIE}=`));
}
