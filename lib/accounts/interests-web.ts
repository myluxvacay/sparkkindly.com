// The interests save POST (plan 3D, Task 4) as a plain function of a Request, in the style of children-web.ts. Origin is
// checked first; the owner is the session's context only (the account holder, or the active child profile): any account
// or profile id in the form is never read. Consent-pending teens and child contexts may save (save_interests). The
// redirect carries an outcome code only. Verified by tests/unit/account-dashboard.test.ts.
import { readCookie, readForm, sameOrigin, seeOther } from '@/lib/admin/guard';
import type { Db } from '@/lib/db';
import { getContext } from './context';
import { setInterests } from './interests';
import { can, childCan } from './policy';
import { ACCOUNT_COOKIE, forbidden } from './web';

const result = (code: string) => seeOther(`/me/interests/?r=${code}#result`);
// A field that is not a whole number stays NaN, which setInterests refuses.
const numbers = (form: URLSearchParams, name: string) => form.getAll(name).map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));

export async function saveInterestsRequest(request: Request, d: { db: Db; now: Date }): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  const ctx = await getContext(d.db, readCookie(request, ACCOUNT_COOKIE), d.now);
  if (!ctx) return seeOther('/account/sign-in/');
  const allowed = ctx.profile ? childCan('save_interests') : can(ctx.account.ageGroup, ctx.account.consent, 'save_interests');
  if (!allowed) return result('no');
  const form = (await readForm(request)) ?? new URLSearchParams();
  const owner = { accountId: ctx.account.id, profileId: ctx.profile?.id ?? null };
  const r = await setInterests(d.db, owner, { topicIds: numbers(form, 'topic'), worldIds: numbers(form, 'world') });
  return result(r === 'ok' ? 'saved' : 'invalid');
}
