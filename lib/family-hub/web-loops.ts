// Family Hub Phase 2 POSTs (parent side): chores, points, rewards, meals, groceries and the
// kid-view PIN. Same discipline as web.ts (Phase 1): Origin first, the account only from the
// session, membership re-checked inside lib/family-hub/loops.ts on every call.
// Verified by tests/unit/family-hub-phase2-web.test.ts.
import { asAdult, back, f, type HubDeps } from './web';
import {
  addGroceryItem, adjustPoints, createChore, createFavourite, createPlanEntry, createReward, decideCompletion,
  decideMealRequest, decideRedemption, deleteFavourite, deleteGroceryItem, deletePlanEntry, setChoreActive,
  setGroceryChecked, setRewardActive, updateChore,
} from './loops';
import { clearKidPin, lockKidView, setKidPin } from './kid-session';

export const createChoreRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await createChore(d.db, circleId, ctx.account.id, {
      kidProfileId: form.get('kid_id'), title: form.get('title'), cadence: form.get('cadence'), points: form.get('points'),
      scheduleDays: form.getAll('days'),
    });
    return back(circleId, 'chores/', r === null ? 'no' : r === 'invalid' ? 'invalid' : r === 'limit' ? 'limit' : 'added');
  });

export const updateChoreRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await updateChore(d.db, circleId, ctx.account.id, f(form, 'chore_id'), {
      title: form.get('title'), cadence: form.get('cadence'), points: form.get('points'), scheduleDays: form.getAll('days'),
    });
    return back(circleId, 'chores/', r === null ? 'no' : r === 'invalid' ? 'invalid' : 'chore-ok');
  });

export const choreActiveRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const ok = await setChoreActive(d.db, circleId, ctx.account.id, f(form, 'chore_id'), f(form, 'active') === 'true');
    return back(circleId, 'chores/', ok ? 'chore-ok' : 'no');
  });

export const completionDecideRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const ok = await decideCompletion(d.db, circleId, ctx.account.id, f(form, 'completion_id'), f(form, 'action') === 'approve', d.now);
    return back(circleId, 'chores/', ok ? 'decided' : 'no');
  });

export const pointsAdjustRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await adjustPoints(d.db, circleId, ctx.account.id, f(form, 'kid_id'), form.get('delta'), form.get('note'));
    return back(circleId, 'chores/', r === null ? 'no' : r === 'ok' ? 'adjusted' : r === 'balance' ? 'balance' : 'invalid');
  });

export const createRewardRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await createReward(d.db, circleId, ctx.account.id, { title: form.get('title'), costPoints: form.get('cost_points') });
    return back(circleId, 'rewards/', r === null ? 'no' : r === 'invalid' ? 'invalid' : r === 'limit' ? 'limit' : 'added');
  });

export const rewardActiveRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const ok = await setRewardActive(d.db, circleId, ctx.account.id, f(form, 'reward_id'), f(form, 'active') === 'true');
    return back(circleId, 'rewards/', ok ? 'reward-ok' : 'no');
  });

export const redemptionDecideRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await decideRedemption(d.db, circleId, ctx.account.id, f(form, 'redemption_id'), f(form, 'action') === 'approve', d.now);
    return back(circleId, 'rewards/', r === 'ok' ? 'decided' : r === 'balance' ? 'balance' : 'no');
  });

export const createFavouriteRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await createFavourite(d.db, circleId, ctx.account.id, form.get('title'));
    return back(circleId, 'meals/', r === null ? 'no' : r === 'invalid' ? 'invalid' : r === 'limit' ? 'limit' : 'fav-added');
  });

export const deleteFavouriteRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const ok = await deleteFavourite(d.db, circleId, ctx.account.id, f(form, 'favourite_id'));
    return back(circleId, 'meals/', ok ? 'fav-deleted' : 'no');
  });

export const mealDecideRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const accept = f(form, 'action') === 'accept';
    const r = await decideMealRequest(d.db, circleId, ctx.account.id, f(form, 'request_id'), {
      accept, dateStr: form.get('plan_date'), declineMessage: form.get('decline_message'),
    }, d.now);
    return back(circleId, 'meals/', r === 'accepted' ? 'meal-accepted' : r === 'declined' ? 'meal-declined' : r === 'limit' ? 'limit' : r === 'invalid' ? 'invalid' : 'no');
  });

export const createPlanRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await createPlanEntry(d.db, circleId, ctx.account.id, {
      dateStr: form.get('plan_date'), mealText: form.get('meal_text'), kidProfileId: form.get('kid_id') || null,
    });
    return back(circleId, 'meals/', r === null ? 'no' : r === 'invalid' ? 'invalid' : r === 'limit' ? 'limit' : 'plan-added');
  });

export const deletePlanRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const ok = await deletePlanEntry(d.db, circleId, ctx.account.id, f(form, 'plan_id'));
    return back(circleId, 'meals/', ok ? 'plan-deleted' : 'no');
  });

export const addGroceryRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const r = await addGroceryItem(d.db, circleId, ctx.account.id, {
      mealPlanId: form.get('plan_id') || null, itemText: form.get('item_text'), quantityText: form.get('quantity_text'),
    });
    return back(circleId, 'meals/', r === null ? 'no' : r === 'invalid' ? 'invalid' : r === 'limit' ? 'limit' : 'grocery-added');
  });

export const groceryActRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const action = f(form, 'action');
    const ok = action === 'delete'
      ? await deleteGroceryItem(d.db, circleId, ctx.account.id, f(form, 'item_id'))
      : await setGroceryChecked(d.db, circleId, ctx.account.id, f(form, 'item_id'), action === 'check');
    return back(circleId, 'meals/', ok ? 'grocery-ok' : 'no');
  });

// Kid-view PIN management lives on the kids page: set/reset (revokes sessions), clear (kid
// view off), lock (revokes sessions, PIN kept).
export const kidPinRequest = (request: Request, d: HubDeps, circleId: string) =>
  asAdult(request, d, async (ctx, form) => {
    const kidId = f(form, 'kid_id');
    const action = f(form, 'action');
    const ok = action === 'set'
      ? await setKidPin(d.db, circleId, ctx.account.id, kidId, form.get('pin'))
      : action === 'clear'
        ? await clearKidPin(d.db, circleId, ctx.account.id, kidId)
        : action === 'lock'
          ? await lockKidView(d.db, circleId, ctx.account.id, kidId)
          : false;
    return back(circleId, 'kids/', ok ? 'pin-ok' : 'pin-no');
  });
