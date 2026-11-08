// Who may see a sponsor line and which items may carry one (plan 6, spec Project 6 and 4a.5). Decided on the server and
// failing closed: an anonymous visitor or a signed-in adult in the adult context only; never a child profile, a 13-17
// account (pending or confirmed), or a session whose lookup failed. Only a published `adults` item outside the Kids
// world and the kids risk tier. The viewer comes from the session cookie alone, through the same getContext the public
// scope uses: no cookie or a stale one is a signed-out visitor; a lookup that throws could be a child's, so it is
// `unknown` and sees nothing. No Next.js imports. Verified by tests/unit/sponsorship-rules.test.ts and
// tests/unit/sponsorship-select.test.ts.
import { getContext } from '@/lib/accounts/context';
import { can, type AgeGroup, type Consent } from '@/lib/accounts/policy';
import type { Db } from '@/lib/db';

export type SponsorViewer =
  | { kind: 'anonymous' }
  | { kind: 'account'; group: AgeGroup; consent: Consent; profile: boolean }
  | { kind: 'unknown' };

export function viewerMaySeeSponsorship(viewer: SponsorViewer): boolean {
  if (viewer?.kind === 'anonymous') {
    return true;
  }
  if (viewer?.kind !== 'account' || viewer.profile !== false) {
    return false;
  }
  return viewer.group === 'adult' && can(viewer.group, viewer.consent, 'see_sponsorship');
}

// The only worlds that may carry sponsorship (owner decision, 8 November 2026). Play, Together and Kids never do.
export const SPONSOR_WORLDS = ['save', 'grow', 'discover'] as const;
export const worldMaySponsor = (slug: string): boolean => (SPONSOR_WORLDS as readonly string[]).includes(slug);

export type SponsorableItem = { audience: string; worldSlug: string; riskTier: string; status: string };

export const itemMayCarrySponsorship = (i: SponsorableItem): boolean =>
  i.status === 'published' && i.audience === 'adults' && worldMaySponsor(i.worldSlug) && i.riskTier !== 'kids';

// The same rule in SQL, over `items i JOIN worlds w`, for the click counter.
export const ITEM_SPONSORABLE_SQL = `i.status = 'published' AND i.audience = 'adults' AND w.slug IN ('save', 'grow', 'discover') AND i.risk_tier <> 'kids'`;

export async function sponsorViewerForSession(db: Db, token: string | undefined, now: Date): Promise<SponsorViewer> {
  if (!token) {
    return { kind: 'anonymous' };
  }
  try {
    const ctx = await getContext(db, token, now);
    if (!ctx) {
      return { kind: 'anonymous' };
    }
    return { kind: 'account', group: ctx.account.ageGroup, consent: ctx.account.consent, profile: ctx.profile !== null };
  } catch (err) {
    console.error('sponsorship viewer lookup failed:', (err as Error)?.name);
    return { kind: 'unknown' };
  }
}
