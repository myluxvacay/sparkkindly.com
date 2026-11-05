// The circle POSTs and the circle page loader (plan 4A) as plain functions of a Request, in the style of
// lib/accounts/children-web.ts. With ACCOUNTS_ENABLED or CIRCLES_ENABLED off everything is a 404. Each POST checks
// Origin, takes the account only from requireAdultContext(getContext) (a child context gets 403; any account id in the
// form is never read as the actor), spends the per-account allowance, and for a circle URL first requires the caller's
// own current membership: a stranger gets the same neutral answer as a circle that does not exist. Redirects carry an
// outcome code only. Verified by tests/unit/circles-web.test.ts.
import { seeOther } from '@/lib/admin/guard';
import { asAdult } from '@/lib/accounts/children-web';
import { listChildProfiles } from '@/lib/accounts/children';
import { getContext } from '@/lib/accounts/context';
import { circleActionLimits, circleCreateLimits } from '@/lib/accounts/limits';
import { tooMany } from '@/lib/accounts/web';
import { circlesEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import { addChildToCircle, removeChildFromCircle } from './children';
import { closeCircle, removeMember, transferOwnership } from './owner';
import { createCircle, getCircleForMember, isSlug, leaveCircle, type CircleView } from './repo';

export type CircleDeps = { db: Db; now: Date; limit?: (accountId: string) => boolean };
type Act = (accountId: string, form: URLSearchParams) => Promise<Response>;

const notFound = () => new Response('Not found', { status: 404 });
const GONE = '/circles/?r=gone#result';
const back = (slug: string, code: string) => seeOther(`/circles/${slug}/?r=${code}#result`);
const checked = (form: URLSearchParams) => form.get('confirm') === 'on';
const field = (form: URLSearchParams, name: string) => form.get(name) ?? '';

export function post(request: Request, d: CircleDeps, limit: (id: string) => boolean, act: Act): Promise<Response> {
  if (!circlesEnabled()) return Promise.resolve(notFound());
  return asAdult(request, d, async (ctx, form) => {
    if (!(d.limit ?? limit)(ctx.account.id)) return tooMany();
    return act(ctx.account.id, form);
  });
}

// A POST under /circles/<slug>/: only for a current member of that circle.
export function scoped(request: Request, d: CircleDeps, slug: string, act: Act): Promise<Response> {
  return post(request, d, circleActionLimits, async (accountId, form) => {
    if (!isSlug(slug) || !(await getCircleForMember(d.db, accountId, slug))) return seeOther(GONE);
    return act(accountId, form);
  });
}

export const createCircleRequest = (request: Request, d: CircleDeps) =>
  post(request, d, circleCreateLimits, async (accountId, form) => {
    const input = {
      name: form.get('name'),
      kind: form.get('kind'),
      yourName: form.get('your_name'),
      timeZone: form.get('time_zone') ?? undefined,
      description: form.get('description'),
    };
    const r = await createCircle(d.db, accountId, input, d.now);
    if (r.status === 'created') return back(r.slug, 'created');
    const code = { invalid: 'invalid', not_allowed: 'no', limit: 'limit' }[r.status];
    return seeOther(`/circles/new/?r=${code}#result`);
  });

export const leaveCircleRequest = (request: Request, d: CircleDeps, slug: string) =>
  scoped(request, d, slug, async (accountId) => {
    const r = await leaveCircle(d.db, accountId, slug, d.now);
    if (r === 'left') return seeOther('/circles/?r=left#result');
    return r === 'owner_must_transfer' ? back(slug, 'owner-leave') : seeOther(GONE);
  });

const OWNER_CODES = { not_owner: 'not-owner', closed: 'read-only' } as const;

export const removeMemberRequest = (request: Request, d: CircleDeps, slug: string) =>
  scoped(request, d, slug, async (accountId, form) => {
    if (!checked(form)) return back(slug, 'confirm');
    const member = { accountId: field(form, 'member_account'), profileId: form.get('member_profile') || null };
    const r = await removeMember(d.db, accountId, slug, member, d.now);
    const codes = { ...OWNER_CODES, removed: 'removed', not_found: 'member-gone', is_owner: 'is-owner' } as const;
    return back(slug, codes[r]);
  });

export const transferRequest = (request: Request, d: CircleDeps, slug: string) =>
  scoped(request, d, slug, async (accountId, form) => {
    if (!checked(form)) return back(slug, 'confirm');
    const r = await transferOwnership(d.db, accountId, slug, field(form, 'to_account'), d.now);
    return back(slug, { ...OWNER_CODES, transferred: 'transferred', not_eligible: 'not-eligible' }[r]);
  });

export const closeCircleRequest = (request: Request, d: CircleDeps, slug: string) =>
  scoped(request, d, slug, async (accountId, form) => {
    if (!checked(form)) return back(slug, 'confirm');
    return back(slug, (await closeCircle(d.db, accountId, slug, d.now)) === 'closed' ? 'closed' : 'not-owner');
  });

const CHILD_CODES = {
  added: 'child-added',
  invalid: 'child-invalid',
  not_allowed: 'child-no',
  not_family: 'child-family',
  has_teen: 'child-teen',
  limit: 'child-limit',
  already: 'child-already',
} as const;

export const addChildRequest = (request: Request, d: CircleDeps, slug: string) =>
  scoped(request, d, slug, async (accountId, form) => {
    const r = await addChildToCircle(d.db, accountId, slug, field(form, 'profile_id'), form.get('confirm'), d.now);
    return back(slug, CHILD_CODES[r]);
  });

export const removeChildRequest = (request: Request, d: CircleDeps, slug: string) =>
  scoped(request, d, slug, async (accountId, form) => {
    const ok = await removeChildFromCircle(d.db, accountId, slug, field(form, 'profile_id'), d.now);
    return back(slug, ok ? 'child-removed' : 'child-gone');
  });

export type CirclePage =
  | { status: 'not_found' | 'sign_in' | 'child' }
  | { status: 'ok'; view: CircleView; children: { id: string; displayName: string }[] };

// What /circles/<slug>/ shows. A non-member gets not_found (a 404, so whether the circle exists does not leak).
// `children` are the viewer's own child profiles that could be added (open family circles only).
export async function loadCirclePage(db: Db, token: string, slug: string, now: Date): Promise<CirclePage> {
  if (!circlesEnabled()) return { status: 'not_found' };
  const ctx = await getContext(db, token, now);
  if (!ctx) return { status: 'sign_in' };
  if (ctx.profile) return { status: 'child' };
  const view = await getCircleForMember(db, ctx.account.id, slug);
  if (!view) return { status: 'not_found' };
  const inCircle = new Set(view.members.map((m) => m.profileId));
  const canAdd = view.kind === 'family' && view.status === 'open' && ctx.account.ageGroup === 'adult';
  const own = canAdd ? await listChildProfiles(db, ctx.account.id) : [];
  const children = own.filter((p) => !inCircle.has(p.id)).map((p) => ({ id: p.id, displayName: p.displayName }));
  return { status: 'ok', view, children };
}
