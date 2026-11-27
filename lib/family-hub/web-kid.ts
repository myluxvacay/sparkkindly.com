// Kid-view POSTs and page state (Phase 2). The kid view's only credential is the kid-view
// cookie (lib/family-hub/kid-session.ts): these handlers resolve it and take the (circle,
// kid) from the token — the ids in the URL must MATCH the token, never replace it — and
// they never read the account cookie, so a kid session carries no adult powers and an
// adult session is neither needed nor used here. Origin is checked first, as everywhere.
// Verified by tests/unit/family-hub-phase2-web.test.ts.
import { readCookie, readForm, sameOrigin, seeOther } from '@/lib/admin/guard';
import { forbidden } from '@/lib/accounts/web';
import { familyHubEnabled } from '@/lib/config';
import type { Db } from '@/lib/db';
import {
  createKidViewSession, kidCookie, kidCookieCleared, kidViewStatus, resolveKidView, revokeKidView, verifyKidPin,
  KID_COOKIE, type KidViewContext,
} from './kid-session';
import { kidMarkChore, kidMealRequest, kidRequestRedemption } from './loops';

export type KidDeps = { db: Db; now: Date };

const kidHome = (circleId: string, kidProfileId: string, code?: string) =>
  `/family/${circleId}/kid/${kidProfileId}/${code ? `?r=${code}#result` : ''}`;

export type KidPageState =
  | { kind: 'in'; ctx: KidViewContext }
  | { kind: 'pin' } // profile exists, PIN set, no (or wrong-scope) session: show the PIN pad
  | { kind: 'off' } // profile exists, no PIN: kid view disabled
  | { kind: 'missing' }; // no such profile in that circle

export async function kidPageState(
  db: Db, request: Request, circleId: string, kidProfileId: string, now: Date,
): Promise<KidPageState> {
  const status = await kidViewStatus(db, circleId, kidProfileId);
  if (!status.exists) return { kind: 'missing' };
  if (!status.hasPin) return { kind: 'off' };
  const ctx = await resolveKidView(db, readCookie(request, KID_COOKIE), now);
  if (ctx && ctx.circleId === circleId && ctx.kidProfileId === kidProfileId) return { kind: 'in', ctx };
  return { kind: 'pin' };
}

export const enterKidViewRequest = async (request: Request, d: KidDeps, circleId: string, kidProfileId: string): Promise<Response> => {
  if (!familyHubEnabled()) return new Response('Not found', { status: 404 });
  if (!sameOrigin(request)) return forbidden();
  const form = (await readForm(request)) ?? new URLSearchParams();
  const checked = await verifyKidPin(d.db, circleId, kidProfileId, form.get('pin'), d.now);
  if (checked !== 'ok') {
    return seeOther(kidHome(circleId, kidProfileId, checked === 'locked' ? 'locked' : checked === 'off' ? 'off' : 'wrong'));
  }
  const token = await createKidViewSession(d.db, circleId, kidProfileId, d.now);
  const res = seeOther(kidHome(circleId, kidProfileId));
  res.headers.append('Set-Cookie', kidCookie(token));
  return res;
};

async function asKid(
  request: Request, d: KidDeps, circleId: string, kidProfileId: string,
  act: (ctx: KidViewContext, form: URLSearchParams) => Promise<Response>,
): Promise<Response> {
  if (!familyHubEnabled()) return new Response('Not found', { status: 404 });
  if (!sameOrigin(request)) return forbidden();
  const ctx = await resolveKidView(d.db, readCookie(request, KID_COOKIE), d.now);
  if (!ctx || ctx.circleId !== circleId || ctx.kidProfileId !== kidProfileId) return forbidden();
  return act(ctx, (await readForm(request)) ?? new URLSearchParams());
}

export const kidActRequest = (request: Request, d: KidDeps, circleId: string, kidProfileId: string) =>
  asKid(request, d, circleId, kidProfileId, async (ctx, form) => {
    const action = form.get('action') ?? '';
    if (action === 'mark') {
      const r = await kidMarkChore(d.db, ctx, form.get('chore_id') ?? '', d.now);
      return seeOther(kidHome(circleId, kidProfileId, r === 'marked' ? 'marked' : r === 'already' ? 'already' : 'invalid'));
    }
    if (action === 'reward') {
      const r = await kidRequestRedemption(d.db, ctx, form.get('reward_id') ?? '');
      return seeOther(kidHome(circleId, kidProfileId, r === 'ok' ? 'reward-asked' : r === 'balance' ? 'saving' : r === 'already' ? 'already' : 'invalid'));
    }
    if (action === 'meal') {
      const r = await kidMealRequest(d.db, ctx, {
        favouriteId: form.get('favourite_id') || undefined,
        text: form.get('meal_text'),
        desiredDay: form.get('desired_day') || undefined,
      });
      return seeOther(kidHome(circleId, kidProfileId, r === 'ok' ? 'meal-asked' : r === 'limit' ? 'limit' : 'invalid'));
    }
    return seeOther(kidHome(circleId, kidProfileId, 'invalid'));
  });

export const exitKidViewRequest = async (request: Request, d: KidDeps, circleId: string, kidProfileId: string): Promise<Response> => {
  if (!familyHubEnabled()) return new Response('Not found', { status: 404 });
  if (!sameOrigin(request)) return forbidden();
  await revokeKidView(d.db, readCookie(request, KID_COOKIE));
  const res = seeOther(kidHome(circleId, kidProfileId));
  res.headers.append('Set-Cookie', kidCookieCleared());
  return res;
};
