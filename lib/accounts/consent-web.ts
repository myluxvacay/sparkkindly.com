// The parent consent POSTs as plain functions of a Request, in the style of web.ts. Confirm and withdraw take the token
// from the form (never the URL), check Origin and the per-network confirm limit, and answer with a redirect that carries
// only the outcome: no token, no address. Resend is the account holder's own button on /account/.
// Verified by tests/unit/account-consent-web.test.ts.
import { clientKey, readCookie, readForm, sameOrigin, seeOther } from '@/lib/admin/guard';
import { confirmConsent, withdrawConsent } from './consent';
import { confirmLimits, consentResendLimits } from './limits';
import { consentPending } from './policy';
import { getAccount } from './sessions';
import { ACCOUNT_COOKIE, emailConsentRequest, forbidden, tooMany, type Deps } from './web';

type ConsentDeps = Deps & { resends?: typeof consentResendLimits };

const DONE = '/account/consent/?done=';
const INVALID = '/account/consent/?invalid=1#result';

async function consentPost(
  request: Request,
  d: ConsentDeps,
  act: (token: string) => Promise<string>,
  ok: string,
): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  if (!(d.confirms ?? confirmLimits)(clientKey(request))) return tooMany();
  const form = await readForm(request);
  // A database error gets the generic invalid page; the message names no token or address.
  const outcome = await act(form?.get('token') ?? '').catch((err: Error) => {
    console.error('parent consent not recorded:', err.name);
    return 'invalid';
  });
  return seeOther(outcome === ok ? `${DONE}${ok}#result` : INVALID);
}

export const confirmConsentRequest = (request: Request, d: ConsentDeps) =>
  consentPost(request, d, (t) => confirmConsent(d.db, t, d.now), 'confirmed');

export const withdrawConsentRequest = (request: Request, d: ConsentDeps) =>
  consentPost(request, d, (t) => withdrawConsent(d.db, t, d.now), 'withdrawn');

// One resend an hour per account; refused (nothing sent) unless the signed-in account is waiting for consent.
export async function resendConsentRequest(request: Request, d: ConsentDeps): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  const account = await getAccount(d.db, readCookie(request, ACCOUNT_COOKIE), d.now);
  if (!account) return seeOther('/account/sign-in/');
  if (!consentPending(account.ageGroup, account.consent)) return seeOther('/account/');
  if (!(d.resends ?? consentResendLimits)(account.id)) return seeOther('/account/?consent=wait#result');
  d.defer(() => emailConsentRequest(d, account.id));
  return seeOther('/account/?consent=resent#result');
}
