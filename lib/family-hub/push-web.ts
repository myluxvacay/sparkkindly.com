// Family Hub Web Push POSTs (Phase 2.5), in the same shape as web.ts: Origin first, the
// account only from the session, and every subscription write filtered by that account's
// id inside lib/family-hub/push.ts — an endpoint in a form buys nothing on its own.
// Verified by tests/unit/family-hub-push.test.ts.
import { seeOther } from '@/lib/admin/guard';
import { pushEnabled } from './push-config';
import { removeSubscription, saveSubscription, sendTestPush } from './push';
import { asAdult, f, type HubDeps } from './web';

const HOME = '/family/';

export const pushSubscribeRequest = (request: Request, d: HubDeps) =>
  asAdult(request, d, async (ctx, form) => {
    const ok =
      pushEnabled() &&
      (await saveSubscription(
        d.db,
        ctx.account.id,
        { endpoint: form.get('endpoint'), p256dh: form.get('p256dh'), auth: form.get('auth') },
        request.headers.get('user-agent'),
      ));
    return seeOther(`${HOME}?r=${ok ? 'push-on' : 'push-no'}#result`);
  });

export const pushUnsubscribeRequest = (request: Request, d: HubDeps) =>
  asAdult(request, d, async (ctx, form) => {
    const ok = await removeSubscription(d.db, ctx.account.id, f(form, 'endpoint'));
    return seeOther(`${HOME}?r=${ok ? 'push-off' : 'push-no'}#result`);
  });

export const pushTestRequest = (request: Request, d: HubDeps) =>
  asAdult(request, d, async (ctx) => {
    const sent = pushEnabled() ? await sendTestPush(d.db, ctx.account.id) : 0;
    return seeOther(`${HOME}?r=${sent > 0 ? 'push-test' : 'push-no'}#result`);
  });
