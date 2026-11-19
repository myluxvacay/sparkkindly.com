// The promotion entry POST, in the style of lib/accounts/interests-web.ts: a plain function of a Request.
// Origin is checked first; the account comes from the session only (any account id in the form is never read).
// Entry is deliberately narrow: the session must be the account holder (a child profile can never enter a
// draw), the account's own age group must be `adult` (18+, from its date of birth — not from anything the
// form claims), and the form must carry the explicit 18+ attestation. The outcome travels back as a code in
// the redirect, never as text. Verified by tests/unit/promos-web.test.ts.
import { readCookie, readForm, sameOrigin, seeOther } from '@/lib/admin/guard';
import type { Db } from '@/lib/db';
import { getContext } from '@/lib/accounts/context';
import { createAccountActionLimits } from '@/lib/accounts/limits';
import { ACCOUNT_COOKIE, forbidden, tooMany } from '@/lib/accounts/web';
import { getLivePromo, recordEntry } from './repo';
import { promoTypeDef } from './types';

const entryLimits = createAccountActionLimits();

// `limit` replaces the per-account limiter; for tests only.
type EnterDeps = { db: Db; now: Date; limit?: (accountId: string) => boolean };

export async function enterPromoRequest(request: Request, slug: string, d: EnterDeps): Promise<Response> {
  const back = (code: string) => seeOther(`/promos/${slug}/?r=${code}#entry`);
  if (!sameOrigin(request)) return forbidden();
  const ctx = await getContext(d.db, readCookie(request, ACCOUNT_COOKIE), d.now);
  if (!ctx) return seeOther('/account/sign-in/');
  if (!(d.limit ?? entryLimits)(ctx.account.id)) return tooMany();
  // A child profile session can play and streak, but the draw entry belongs to grown-ups only.
  if (ctx.profile) return back('grownups');
  const promo = await getLivePromo(d.db, slug, d.now);
  if (!promo || !promoTypeDef(promo.type)?.takesEntries) return back('closed');
  const form = (await readForm(request)) ?? new URLSearchParams();
  if (form.get('attest') !== 'yes') return back('attest');
  // The account's own recorded age group decides, so a 16- or 17-year-old account cannot attest its way in.
  if (ctx.account.ageGroup !== 'adult') return back('grownups');
  const entered = await recordEntry(d.db, promo.id, ctx.account.id, true);
  return back(entered ? 'entered' : 'already');
}
