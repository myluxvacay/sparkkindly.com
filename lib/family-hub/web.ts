// The Family Hub POSTs as plain functions of a Request, in the style of lib/accounts/children-web.ts.
// Each checks Origin first; the account id comes only from the session context (requireAdultContext),
// and every circle id is re-checked against membership inside lib/family-hub/repo.ts — an id in a
// form buys nothing. Redirects carry an outcome code only (the one exception is the invite token,
// which travels in a URL fragment so it never reaches a server or a log).
// Verified by tests/unit/family-hub-web.test.ts.
import { readCookie, readForm, sameOrigin, seeOther } from '@/lib/admin/guard';
import { getContext, requireAdultContext, type AdultContext } from '@/lib/accounts/context';
import { ACCOUNT_COOKIE, forbidden } from '@/lib/accounts/web';
import { familyHubEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import { zonedLocalToUtc } from './rules';
import {
  acceptInvite, claimRun, createCircle, createEvent, createInvite, createKid, deleteEvent, deleteKid,
  doneRun, getCircle, releaseRun, removeMember, setMemberRole, updateEvent, updateKid, type EventInput,
} from './repo';

export type HubDeps = { db: Db; now: Date };

const SIGN_IN = '/account/sign-in/';
const HOME = '/family/';
const back = (circleId: string, page: string, code: string) => seeOther(`/family/${circleId}/${page}?r=${code}#result`);

async function asAdult(
  request: Request,
  d: HubDeps,
  act: (ctx: AdultContext, form: URLSearchParams) => Promise<Response>,
): Promise<Response> {
  if (!familyHubEnabled()) return new Response('Not found', { status: 404 });
  if (!sameOrigin(request)) return forbidden();
  const ctx = await getContext(d.db, readCookie(request, ACCOUNT_COOKIE), d.now);
  if (!ctx) return seeOther(SIGN_IN);
  const adult = requireAdultContext(ctx);
  if (!adult) return forbidden();
  return act(adult, (await readForm(request)) ?? new URLSearchParams());
}

const f = (form: URLSearchParams, name: string) => form.get(name) ?? '';

export const createCircleRequest = (request: Request, d: HubDeps) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await createCircle(d.db, ctx.account.id, form.get('name'), form.get('time_zone'));
    if (r === 'invalid') return seeOther(`${HOME}new/?r=invalid#result`);
    if (r === 'limit') return seeOther(`${HOME}?r=limit#result`);
    return seeOther(`/family/${r.id}/`);
  });

export const createInviteRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await createInvite(d.db, circleId, ctx.account.id, form.get('email'), d.now);
    if (!r) return back(circleId, '', 'invite-no');
    // The token rides in the fragment: the browser never sends it to a server, and the circle
    // page's small client island turns it into the copyable link exactly once.
    return seeOther(`/family/${circleId}/?r=invite#i=${r.token}`);
  });

export const memberActRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const target = f(form, 'user_id');
    const action = f(form, 'action');
    const ok =
      action === 'remove'
        ? await removeMember(d.db, circleId, ctx.account.id, target)
        : action === 'role'
          ? await setMemberRole(d.db, circleId, ctx.account.id, target, f(form, 'role') === 'organizer' ? 'organizer' : 'member')
          : false;
    return back(circleId, '', ok ? 'member-ok' : 'member-no');
  });

export const acceptInviteRequest = (request: Request, d: HubDeps, token: string) =>
  asAdult(request, d, async (ctx) => {
    const r = await acceptInvite(d.db, token, ctx.account.id, ctx.account.email, d.now);
    if (r.circleId && (r.result === 'joined' || r.result === 'already')) return seeOther(`/family/${r.circleId}/?r=${r.result}#result`);
    return seeOther(`${HOME}?r=invite-${r.result}#result`);
  });

const kidInput = (form: URLSearchParams) => ({
  firstName: form.get('first_name'),
  ageGroup: form.get('age_group'),
  avatarId: form.get('avatar_id'),
  colour: form.get('colour'),
  phone: form.get('phone'),
});

export const createKidRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await createKid(d.db, circleId, ctx.account.id, kidInput(form));
    return back(circleId, 'kids/', r === null ? 'no' : r === 'invalid' ? 'invalid' : r === 'limit' ? 'limit' : 'added');
  });

export const updateKidRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const ok = await updateKid(d.db, circleId, ctx.account.id, f(form, 'kid_id'), kidInput(form));
    return back(circleId, 'kids/', ok ? 'saved' : 'invalid');
  });

export const deleteKidRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const ok = await deleteKid(d.db, circleId, ctx.account.id, f(form, 'kid_id'));
    return back(circleId, 'kids/', ok ? 'deleted' : 'no');
  });

async function eventInput(d: HubDeps, circleId: string, ctx: AdultContext, form: URLSearchParams): Promise<EventInput> {
  const circle = await getCircle(d.db, circleId, ctx.account.id);
  const tz = circle?.timeZone ?? 'UTC';
  const local = (name: string) => {
    const v = form.get(name);
    return v ? zonedLocalToUtc(v, tz) : null;
  };
  const until = form.get('recurrence_until');
  return {
    title: form.get('title'),
    startsAt: local('starts_at'),
    endsAt: local('ends_at'),
    recurrence: form.get('recurrence') === 'weekly' ? 'weekly' : null,
    recurrenceUntil: until ? new Date(`${until}T00:00:00Z`) : null,
    location: form.get('location'),
    notes: form.get('notes'),
    isRun: form.get('is_run') === 'on' || form.get('is_run') === 'true',
    driverUserId: form.get('driver') || null,
    memberIds: form.getAll('member'),
    kidIds: form.getAll('kid'),
  };
}

export const createEventRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await createEvent(d.db, circleId, ctx.account.id, await eventInput(d, circleId, ctx, form));
    return back(circleId, 'calendar/', r === null ? 'no' : r === 'invalid' ? 'invalid' : r === 'limit' ? 'limit' : 'added');
  });

export const updateEventRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const ok = await updateEvent(d.db, circleId, ctx.account.id, f(form, 'event_id'), await eventInput(d, circleId, ctx, form));
    return back(circleId, 'calendar/', ok ? 'saved' : 'invalid');
  });

export const deleteEventRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const ok = await deleteEvent(d.db, circleId, ctx.account.id, f(form, 'event_id'));
    return back(circleId, 'calendar/', ok ? 'deleted' : 'no');
  });

export const runActRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const eventId = f(form, 'event_id');
    const action = f(form, 'action');
    const ok =
      action === 'claim'
        ? await claimRun(d.db, circleId, ctx.account.id, eventId)
        : action === 'release'
          ? await releaseRun(d.db, circleId, ctx.account.id, eventId)
          : action === 'done'
            ? await doneRun(d.db, circleId, ctx.account.id, eventId)
            : false;
    return back(circleId, 'runs/', ok ? 'run-ok' : 'run-no');
  });
