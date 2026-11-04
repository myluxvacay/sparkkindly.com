// The child-profile POSTs (plan 3C) as plain functions of a Request, in the style of web.ts. Each checks Origin first.
// The adult routes (create, delete, switch in, PIN change) take the account id only from requireAdultContext(getContext):
// any account or owner id in the form is never read, and delete and switch take a profile id that the library checks
// against the session's own account. A child context gets 403 on all of them. Redirects carry an outcome code only:
// never a PIN, an id or a count, and wrong and locked PIN answers say nothing about attempts left or time remaining.
// Verified by tests/unit/account-children-web.test.ts.
import { readCookie, readForm, sameOrigin, seeOther } from '@/lib/admin/guard';
import type { Db } from '@/lib/db';
import { createChildProfile, deleteChildProfile } from './children';
import { getContext, requireAdultContext, switchToAdult, switchToProfile, type AdultContext } from './context';
import { changePin } from './pin';
import { ACCOUNT_COOKIE, forbidden } from './web';

type ChildDeps = { db: Db; now: Date };

const SIGN_IN = '/account/sign-in/';
const LIST = '/account/children/';
const PLAYING = '/account/children/playing/';
const result = (code: string, page = LIST) => seeOther(`${page}?r=${code}#result`);

// Runs `act` for a signed-in adult context; no session goes to sign-in, a child context is refused.
async function asAdult(
  request: Request,
  d: ChildDeps,
  act: (ctx: AdultContext, form: URLSearchParams) => Promise<Response>,
): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  const ctx = await getContext(d.db, readCookie(request, ACCOUNT_COOKIE), d.now);
  if (!ctx) return seeOther(SIGN_IN);
  const adult = requireAdultContext(ctx);
  if (!adult) return forbidden();
  return act(adult, (await readForm(request)) ?? new URLSearchParams());
}

const field = (form: URLSearchParams, name: string) => form.get(name) ?? '';

export const createChildRequest = (request: Request, d: ChildDeps) =>
  asAdult(request, d, async (ctx, form) => {
    // The PIN fields count only for the first profile (createChildProfile ignores them once a PIN is set).
    const pin = form.get('pin') || undefined;
    if (pin !== undefined && pin !== form.get('pin_confirm')) return result('mismatch');
    const r = await createChildProfile(
      d.db,
      ctx.account.id,
      { displayName: form.get('display_name'), ageBand: form.get('age_band'), guardianConfirmed: form.get('guardian'), pin },
      d.now,
    );
    const codes = { created: 'created', invalid: 'invalid', not_allowed: 'no', pin_required: 'pin' } as const;
    return result(codes[r.status]);
  });

export const deleteChildRequest = (request: Request, d: ChildDeps) =>
  asAdult(request, d, async (ctx, form) =>
    result((await deleteChildProfile(d.db, ctx.account.id, field(form, 'profile_id'))) ? 'deleted' : 'gone'),
  );

export const switchToChildRequest = (request: Request, d: ChildDeps) =>
  asAdult(request, d, async (_ctx, form) =>
    (await switchToProfile(d.db, readCookie(request, ACCOUNT_COOKIE), field(form, 'profile_id'), d.now))
      ? seeOther(PLAYING)
      : result('gone'),
  );

export const changePinRequest = (request: Request, d: ChildDeps) =>
  asAdult(request, d, async (ctx, form) => {
    const next = field(form, 'new_pin');
    if (next !== form.get('new_pin_confirm')) return result('pin-invalid');
    const r = await changePin(d.db, ctx.account.id, form.get('current_pin'), next, d.now);
    return result(r === 'ok' ? 'pin-changed' : r === 'invalid' ? 'pin-invalid' : r);
  });

// The child context's only action. An adult context has nothing to switch back from, so no PIN is checked or counted:
// switchToAdult's 'ok' for an adult context means "already adult", never "PIN verified" (see context.ts).
export async function switchBackRequest(request: Request, d: ChildDeps): Promise<Response> {
  if (!sameOrigin(request)) return forbidden();
  const token = readCookie(request, ACCOUNT_COOKIE);
  const ctx = await getContext(d.db, token, d.now);
  if (!ctx) return seeOther(SIGN_IN);
  if (!ctx.profile) return seeOther(LIST);
  const form = await readForm(request);
  const r = await switchToAdult(d.db, token, form?.get('pin') ?? '', d.now);
  return r === 'ok' ? seeOther(LIST) : result(r, PLAYING);
}
