// The settings POSTs (plan 3E Task 3) as plain functions of a Request, in the style of children-web.ts. Save, export,
// delete and PIN reset check Origin first and take the account only from requireAdultContext(getContext) via asAdult:
// any account or profile id in the form is never read, and a child context gets 403. Redirects carry an outcome code
// only: never the typed email, a PIN or an id.
// The unsubscribe POST is the exception: mail clients post it (RFC 8058 one-click) from no origin and with no session,
// so it needs neither; the token alone names the account and kind, and every answer is the same whatever the token.
// Verified by tests/unit/account-settings-web.test.ts.
import { clientKey, readCookie, readForm, seeOther } from '@/lib/admin/guard';
import type { Db } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { asAdult } from './children-web';
import { exportAccount } from './export';
import { unsubscribeLimits } from './limits';
import { resetPin } from './pin-reset';
import { deleteOwnAccount } from './self-delete';
import { saveSettings } from './settings';
import { applyUnsubscribe, readUnsubscribeToken, unsubscribeSecret } from './unsubscribe';
import { ACCOUNT_COOKIE, accountCookie, forbidden, tooMany } from './web';

type SettingsDeps = { db: Db; now: Date };

const result = (code: string, page = '/account/settings/') => seeOther(`${page}?r=${code}#result`);

export const saveSettingsRequest = (request: Request, d: SettingsDeps) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await saveSettings(d.db, ctx.account.id, {
      timeZone: form.get('time_zone') ?? undefined,
      notify: { dailySet: form.has('daily_set'), weeklyCircle: form.has('weekly'), invites: form.has('invites') },
    });
    return result(r === 'ok' ? 'saved' : 'invalid');
  });

export const exportRequest = (request: Request, d: SettingsDeps) =>
  asAdult(request, d, async (ctx) => {
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
  asAdult(request, d, async (_ctx, form) => {
    const pin = form.get('new_pin') ?? '';
    if (pin !== form.get('new_pin_confirm')) return result('pin-invalid');
    const r = await resetPin(d.db, readCookie(request, ACCOUNT_COOKIE), pin, d.now);
    if (r === 'not_allowed') return forbidden();
    return result(r === 'ok' ? 'pin-reset' : r === 'stale' ? 'pin-stale' : 'pin-invalid');
  });

type UnsubscribeDeps = { db: Db; env: EnvLike; limits?: typeof unsubscribeLimits };

// A mail client's one-click POST (body List-Unsubscribe=One-Click, token in the URL) gets a plain 200; the page's
// confirm form (token in the body) goes back to the page. Neither answer depends on the token.
export async function unsubscribeRequest(request: Request, d: UnsubscribeDeps): Promise<Response> {
  if (!(d.limits ?? unsubscribeLimits)(clientKey(request))) return tooMany();
  const form = (await readForm(request)) ?? new URLSearchParams();
  const token = new URL(request.url).searchParams.get('t') ?? form.get('t') ?? '';
  const target = readUnsubscribeToken(unsubscribeSecret(d.env), token);
  if (target) {
    await applyUnsubscribe(d.db, target.accountId, target.kind).catch((err: Error) => {
      console.error('unsubscribe not applied:', err.name);
    });
  }
  if (form.get('List-Unsubscribe') === 'One-Click') {
    return new Response('If this link was valid, that email is now turned off.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return result('done', '/account/unsubscribe/');
}
