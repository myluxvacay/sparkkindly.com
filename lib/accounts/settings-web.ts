// The settings POSTs (plan 3E Task 3) as plain functions of a Request, in the style of children-web.ts. Save, export,
// delete and PIN reset check Origin first and take the account only from requireAdultContext(getContext) via asAdult:
// any account or profile id in the form is never read, and a child context gets 403. Redirects carry an outcome code
// only: never the typed email, a PIN or an id. A consent-pending 13 to 15 account saves interests only (spec 4a.5), so
// its settings save is refused with a neutral code. Export and PIN reset allow 30 per account per hour (limits.ts).
// The unsubscribe POST is the exception: mail clients post it (RFC 8058 one-click) from no origin and with no session,
// so it needs neither; the token alone names the account and kind, and every answer is the same whatever the token.
// Verified by tests/unit/account-settings-web.test.ts.
import { clientKey, readCookie, readForm, seeOther } from '@/lib/admin/guard';
import type { Db } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { asAdult } from './children-web';
import { exportAccount } from './export';
import { exportLimits, pinResetLimits, unsubscribeLimits } from './limits';
import { consentPending } from './policy';
import { resetPin } from './pin-reset';
import { deleteOwnAccount } from './self-delete';
import { saveSettings } from './settings';
import { applyUnsubscribe, readUnsubscribeToken, unsubscribeSecret } from './unsubscribe';
import { ACCOUNT_COOKIE, accountCookie, forbidden, tooMany } from './web';

// `limit` replaces the route's per-account limiter; for tests only.
type SettingsDeps = { db: Db; now: Date; limit?: (accountId: string) => boolean };

const result = (code: string, page = '/account/settings/') => seeOther(`${page}?r=${code}#result`);

export const saveSettingsRequest = (request: Request, d: SettingsDeps) =>
  asAdult(request, d, async (ctx, form) => {
    if (consentPending(ctx.account.ageGroup, ctx.account.consent)) return result('pending');
    const r = await saveSettings(d.db, ctx.account.id, {
      timeZone: form.get('time_zone') ?? undefined,
      notify: { dailySet: form.has('daily_set'), weeklyCircle: form.has('weekly'), invites: form.has('invites') },
    });
    return result(r === 'ok' ? 'saved' : 'invalid');
  });

export const exportRequest = (request: Request, d: SettingsDeps) =>
  asAdult(request, d, async (ctx) => {
    if (!(d.limit ?? exportLimits)(ctx.account.id)) return tooMany();
    const data = await exportAccount(d.db, ctx.account.id, d.now);
    if (!data) return seeOther('/account/sign-in/');
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sparkkindly-export.json"',
        'Cache-Control': 'no-store',
      },
    });
  });

export const deleteAccountRequest = (request: Request, d: SettingsDeps) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await deleteOwnAccount(d.db, ctx.account.id, form.get('email'));
    if (r === 'mismatch') return result('mismatch', '/account/settings/delete/');
    // deleted (or already gone): the sessions went with the account; the browser's cookie goes now.
    return seeOther('/account/sign-in/?r=deleted', accountCookie('', 0));
  });

export const resetPinRequest = (request: Request, d: SettingsDeps) =>
  asAdult(request, d, async (ctx, form) => {
    if (!(d.limit ?? pinResetLimits)(ctx.account.id)) return tooMany();
    // Two different PINs go through as no PIN at all, so resetPin still reports a stale session first.
    const pin = form.get('new_pin');
    const r = await resetPin(d.db, readCookie(request, ACCOUNT_COOKIE), pin === form.get('new_pin_confirm') ? pin : null, d.now);
    if (r === 'not_allowed') return forbidden();
    return result(r === 'ok' ? 'pin-reset' : r === 'stale' ? 'pin-stale' : 'pin-invalid');
  });

type UnsubscribeDeps = { db: Db; env: EnvLike; limits?: typeof unsubscribeLimits };

const plain = (text: string, status = 200) =>
  new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

// The answer depends only on where the token came from, never on whether it is valid. Token in the URL is the RFC 8058
// one-click shape (a mail client; the body may be urlencoded, multipart or empty and is never read): a plain 200, never
// a redirect. Token in a form body is the page's own button: back to the page. The per-network limiter counts only
// invalid or absent tokens (a valid one cannot be forged), so a mail provider's shared egress address is never throttled.
export async function unsubscribeRequest(request: Request, d: UnsubscribeDeps): Promise<Response> {
  const fromUrl = new URL(request.url).searchParams.get('t');
  const token = fromUrl ?? (await readForm(request))?.get('t') ?? '';
  const target = readUnsubscribeToken(unsubscribeSecret(d.env), token);
  if (!target && !(d.limits ?? unsubscribeLimits)(clientKey(request))) return tooMany();
  if (target) {
    try {
      await applyUnsubscribe(d.db, target.accountId, target.kind);
    } catch (err) {
      console.error('unsubscribe not applied:', (err as Error).name);
      return plain('Please try again later.', 503);
    }
  }
  return fromUrl !== null ? plain('If this link was valid, that email is now turned off.') : result('done', '/account/unsubscribe/');
}
