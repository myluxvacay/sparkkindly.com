// Sponsorship's web side (plan 6): the item page's loader and the /go/<id>/ click route as plain functions. With
// SPONSORSHIP_ENABLED off the loader reads nothing (the page renders exactly as before) and the route is a 404. The viewer
// comes from the account cookie only while ACCOUNTS_ENABLED is on (as the public scope does); a failed lookup sees
// nothing. The click route rate-limits per network, then redirects 302 to the sponsorship's stored link for an eligible
// viewer and home for anyone else, with no referrer, no caching and no cookie. No Next.js imports.
// Verified by tests/unit/sponsorship-web.test.tsx.
import { ACCOUNT_COOKIE } from '@/lib/accounts/web';
import { clientKey, createCodeLimits, readCookie } from '@/lib/admin/guard';
import { accountsEnabled, sponsorshipEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import { recordClick } from './clicks';
import { sponsorViewerForSession, viewerMaySeeSponsorship } from './eligibility';
import { utcDay } from './rules';
import { sponsorFor, type SponsorLine } from './select';

export async function loadSponsorLine(db: Db, token: string | undefined, itemId: string, now: Date): Promise<SponsorLine | null> {
  if (!sponsorshipEnabled()) {
    return null;
  }
  if (!viewerMaySeeSponsorship(await sponsorViewerForSession(db, token, now))) {
    return null;
  }
  return sponsorFor(db, itemId, utcDay(now));
}

// Clicks: 60 per network (IPv4 /24, IPv6 /64) per hour. ponytail: per-process memory, like the other limits.
const shared = globalThis as unknown as { __sparkSponsorClickLimits?: (client: string) => boolean };
const clickLimits = (shared.__sparkSponsorClickLimits ??= createCodeLimits(Date.now, 60));

type ClickDeps = { db: Db; now: Date; limit?: (client: string) => boolean };
const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const redirect = (location: string) => new Response(null, { status: 302, headers: { ...HEADERS, Location: location } });

export async function clickRequest(request: Request, d: ClickDeps, rawId: string): Promise<Response> {
  if (!sponsorshipEnabled()) {
    return new Response('Not found', { status: 404, headers: HEADERS });
  }
  if (!(d.limit ?? clickLimits)(clientKey(request))) {
    return new Response('Too many requests', { status: 429, headers: HEADERS });
  }
  const id = /^\d{1,9}$/.test(rawId) ? Number(rawId) : 0;
  const token = accountsEnabled() ? readCookie(request, ACCOUNT_COOKIE) || undefined : undefined;
  const viewer = await sponsorViewerForSession(d.db, token, d.now);
  const hit = id ? await recordClick(d.db, id, utcDay(d.now), viewer) : null;
  return redirect(hit ? hit.url : '/');
}
