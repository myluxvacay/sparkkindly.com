// @vitest-environment node
// Family Hub Phase 2 data layer: chores & points, rewards, meals, groceries and the kid
// view. The invariants under test are the safety ones: points exist only after a parent
// approves; a period can be completed once; a redemption can never spend what is not
// there; every function is scoped to its circle (parents) or its one kid (kid view).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { createCircle, createKid, listActivity, listKids } from '@/lib/family-hub/repo';
import {
  addGroceryItem, adjustPoints, balanceOf, createChore, createFavourite, createPlanEntry, createReward,
  decideCompletion, decideMealRequest, decideRedemption, kidChores, kidMarkChore, kidMealRequest,
  kidMealRequests, kidPoints, kidRequestRedemption, kidRewards, kidSelf, listChores, listGroceries,
  listMealRequests, listPendingCompletions, listPendingRedemptions, listPlan, setChoreActive,
} from '@/lib/family-hub/loops';
import {
  createKidViewSession, kidViewStatus, resolveKidView, setKidPin, verifyKidPin, type KidViewContext,
} from '@/lib/family-hub/kid-session';
import { DEFAULT_DECLINE_MESSAGE } from '@/lib/family-hub/rules';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-27T17:00:00Z'); // Friday noon in America/New_York
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

async function adult(): Promise<{ id: string; email: string }> {
  const email = `hub2-${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: '1990-05-05' }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return { id: r.accountId, email };
}

async function family(): Promise<{ parent: { id: string }; circleId: string; kidId: string }> {
  const parent = await adult();
  const c = await createCircle(db, parent.id, 'The Loops Family', 'America/New_York');
  if (typeof c !== 'object') throw new Error('circle failed');
  const kid = await createKid(db, c.id, parent.id, { firstName: 'Sam', ageGroup: '6-8', avatarId: 'dog', colour: 'teal', phone: null });
  if (typeof kid !== 'object' || kid === null || !('id' in kid)) throw new Error('kid failed');
  return { parent, circleId: c.id, kidId: kid.id };
}

async function kidCtx(circleId: string, kidId: string, parentId: string, pin = '1357'): Promise<KidViewContext> {
  if (!(await setKidPin(db, circleId, parentId, kidId, pin))) throw new Error('pin set failed');
  if ((await verifyKidPin(db, circleId, kidId, pin, T0)) !== 'ok') throw new Error('pin verify failed');
  const token = await createKidViewSession(db, circleId, kidId, T0);
  const ctx = await resolveKidView(db, token, T0);
  if (!ctx) throw new Error('kid session failed');
  return ctx;
}

const mustId = (r: unknown): string => {
  if (typeof r !== 'object' || r === null || !('id' in r)) throw new Error('expected an id result');
  return (r as { id: string }).id;
};

describe('chores: marking is not points; approval is', () => {
  it('kid mark → pending → parent approve → points land exactly once', async () => {
    const { parent, circleId, kidId } = await family();
    const chore = await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Feed the cat', cadence: 'daily', points: 10 });
    const choreId = mustId(chore);
    const ctx = await kidCtx(circleId, kidId, parent.id);

    expect(await kidMarkChore(db, ctx, choreId, T0)).toBe('marked');
    expect(await kidPoints(db, circleId, parent.id, kidId)).toBe(0); // marking alone is worth nothing
    expect(await kidMarkChore(db, ctx, choreId, T0)).toBe('already'); // same period twice is impossible

    const pending = (await listPendingCompletions(db, circleId, parent.id))!;
    expect(pending.length).toBe(1);
    expect(pending[0].periodKey).toBe('2026-11-27');

    expect(await decideCompletion(db, circleId, parent.id, pending[0].id, true, T0)).toBe(true);
    expect(await kidPoints(db, circleId, parent.id, kidId)).toBe(10);
    expect(await decideCompletion(db, circleId, parent.id, pending[0].id, true, T0)).toBe(false); // no double decision
    expect(await kidPoints(db, circleId, parent.id, kidId)).toBe(10);
    expect(await kidMarkChore(db, ctx, choreId, T0)).toBe('already'); // approved period is closed

    const activity = (await listActivity(db, circleId, parent.id, 10))!;
    expect(activity.some((a) => a.kind === 'chore')).toBe(true); // the Hub home feed picks it up
  });

  it('a declined mark earns nothing, and the kid can mark again for the same period', async () => {
    const { parent, circleId, kidId } = await family();
    const choreId = mustId(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Make bed', cadence: 'daily', points: 5 }));
    const ctx = await kidCtx(circleId, kidId, parent.id);
    expect(await kidMarkChore(db, ctx, choreId, T0)).toBe('marked');
    const pending = (await listPendingCompletions(db, circleId, parent.id))!;
    expect(await decideCompletion(db, circleId, parent.id, pending[0].id, false, T0)).toBe(true);
    expect(await kidPoints(db, circleId, parent.id, kidId)).toBe(0);
    expect(await kidMarkChore(db, ctx, choreId, T0)).toBe('marked'); // re-mark after a send-back
    const again = (await listPendingCompletions(db, circleId, parent.id))!;
    expect(again.length).toBe(1);
    expect(await decideCompletion(db, circleId, parent.id, again[0].id, true, T0)).toBe(true);
    expect(await kidPoints(db, circleId, parent.id, kidId)).toBe(5);
  });

  it('a one-off chore can be completed once, ever', async () => {
    const { parent, circleId, kidId } = await family();
    const choreId = mustId(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Tidy the garage', cadence: 'one_off', points: 50 }));
    const ctx = await kidCtx(circleId, kidId, parent.id);
    await kidMarkChore(db, ctx, choreId, T0);
    const pending = (await listPendingCompletions(db, circleId, parent.id))!;
    expect(pending[0].periodKey).toBe('once');
    await decideCompletion(db, circleId, parent.id, pending[0].id, true, T0);
    const tomorrow = new Date('2026-11-28T17:00:00Z');
    expect(await kidMarkChore(db, ctx, choreId, tomorrow)).toBe('already');
    const states = await kidChores(db, ctx, tomorrow);
    expect(states[0].state).toBe('approved');
  });

  it('the database itself refuses a second completion row for one period', async () => {
    const { parent, circleId, kidId } = await family();
    const choreId = mustId(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Dishes', cadence: 'daily', points: 5 }));
    await db.query('INSERT INTO hub_chore_completions (chore_id, circle_id, kid_profile_id, period_key) VALUES ($1, $2, $3, $4)', [choreId, circleId, kidId, '2026-11-27']);
    await expect(
      db.query('INSERT INTO hub_chore_completions (chore_id, circle_id, kid_profile_id, period_key) VALUES ($1, $2, $3, $4)', [choreId, circleId, kidId, '2026-11-27']),
    ).rejects.toThrow();
  });

  it('a retired chore cannot be marked', async () => {
    const { parent, circleId, kidId } = await family();
    const choreId = mustId(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Old chore', cadence: 'daily', points: 5 }));
    const ctx = await kidCtx(circleId, kidId, parent.id);
    expect(await setChoreActive(db, circleId, parent.id, choreId, false)).toBe(true);
    expect(await kidMarkChore(db, ctx, choreId, T0)).toBe('invalid');
    expect((await kidChores(db, ctx, T0)).length).toBe(0);
  });
});

describe('points adjustments', () => {
  it('need a reason and can never push a balance below zero', async () => {
    const { parent, circleId, kidId } = await family();
    expect(await adjustPoints(db, circleId, parent.id, kidId, 20, '')).toBe('invalid');
    expect(await adjustPoints(db, circleId, parent.id, kidId, -5, 'Too far')).toBe('balance');
    expect(await adjustPoints(db, circleId, parent.id, kidId, 20, 'Helped a neighbour')).toBe('ok');
    expect(await balanceOf(db, circleId, kidId)).toBe(20);
    expect(await adjustPoints(db, circleId, parent.id, kidId, -20, 'Spent at the fair')).toBe('ok');
    expect(await balanceOf(db, circleId, kidId)).toBe(0);
  });
});

describe('rewards: requests, balance checks at both ends', () => {
  it('kid cannot ask beyond the balance; approval spends exactly the price', async () => {
    const { parent, circleId, kidId } = await family();
    const rewardId = mustId(await createReward(db, circleId, parent.id, { title: 'Pick Friday’s movie', costPoints: 50 }));
    const ctx = await kidCtx(circleId, kidId, parent.id);
    expect(await kidRequestRedemption(db, ctx, rewardId)).toBe('balance'); // 0 points
    await adjustPoints(db, circleId, parent.id, kidId, 50, 'Seed points');
    expect(await kidRequestRedemption(db, ctx, rewardId)).toBe('ok');
    expect(await kidRequestRedemption(db, ctx, rewardId)).toBe('already'); // one pending ask per reward
    const pending = (await listPendingRedemptions(db, circleId, parent.id))!;
    expect(pending.length).toBe(1);
    expect(pending[0].costPoints).toBe(50);
    expect(await decideRedemption(db, circleId, parent.id, pending[0].id, true, T0)).toBe('ok');
    expect(await balanceOf(db, circleId, kidId)).toBe(0);
    expect(await decideRedemption(db, circleId, parent.id, pending[0].id, true, T0)).toBe(false);
    const view = await kidRewards(db, ctx);
    expect(view.mine[0].state).toBe('approved');
  });

  it('approval re-checks the balance: spend elsewhere first and approval waits', async () => {
    const { parent, circleId, kidId } = await family();
    const rewardId = mustId(await createReward(db, circleId, parent.id, { title: 'Zoo trip', costPoints: 50 }));
    const ctx = await kidCtx(circleId, kidId, parent.id);
    await adjustPoints(db, circleId, parent.id, kidId, 50, 'Seed points');
    await kidRequestRedemption(db, ctx, rewardId);
    await adjustPoints(db, circleId, parent.id, kidId, -20, 'Spent some elsewhere');
    const pending = (await listPendingRedemptions(db, circleId, parent.id))!;
    expect(await decideRedemption(db, circleId, parent.id, pending[0].id, true, T0)).toBe('balance');
    expect((await listPendingRedemptions(db, circleId, parent.id))!.length).toBe(1); // still waiting, not lost
    expect(await decideRedemption(db, circleId, parent.id, pending[0].id, false, T0)).toBe('ok');
    expect(await balanceOf(db, circleId, kidId)).toBe(30);
  });
});

describe('meals: request → accept → board → groceries', () => {
  it('a favourite request accepted for a day lands on the board; groceries hang off it', async () => {
    const { parent, circleId, kidId } = await family();
    const fav = await createFavourite(db, circleId, parent.id, 'Pasta night');
    const ctx = await kidCtx(circleId, kidId, parent.id);
    expect(await kidMealRequest(db, ctx, { favouriteId: mustId(fav), desiredDay: '2026-11-28' })).toBe('ok');
    const pending = (await listMealRequests(db, circleId, parent.id, 'pending'))!;
    expect(pending.length).toBe(1);
    expect(pending[0].requestedText).toBe('Pasta night');
    expect(await decideMealRequest(db, circleId, parent.id, pending[0].id, { accept: true }, T0)).toBe('accepted'); // no date → the desired day
    const plan = (await listPlan(db, circleId, parent.id, '2026-11-23', '2026-11-29'))!;
    expect(plan.length).toBe(1);
    expect(plan[0].planDate).toBe('2026-11-28');
    expect(plan[0].kidName).toBe('Sam');
    expect(await decideMealRequest(db, circleId, parent.id, pending[0].id, { accept: true }, T0)).toBe(false); // decided once
    const item = await addGroceryItem(db, circleId, parent.id, { mealPlanId: plan[0].id, itemText: 'Pasta', quantityText: '500g' });
    expect(typeof item).toBe('object');
    const list = (await listGroceries(db, circleId, parent.id, plan.map((p) => p.id)))!;
    expect(list.length).toBe(1);
    expect(list[0].itemText).toBe('Pasta');
  });

  it('a declined request carries the kind default note back to the kid', async () => {
    const { parent, circleId, kidId } = await family();
    const ctx = await kidCtx(circleId, kidId, parent.id);
    expect(await kidMealRequest(db, ctx, { text: 'Ice cream for dinner' })).toBe('ok');
    const pending = (await listMealRequests(db, circleId, parent.id, 'pending'))!;
    expect(await decideMealRequest(db, circleId, parent.id, pending[0].id, { accept: false }, T0)).toBe('declined');
    const mine = await kidMealRequests(db, ctx);
    expect(mine[0].state).toBe('declined');
    expect(mine[0].declineMessage).toBe(DEFAULT_DECLINE_MESSAGE);
  });

  it('parents can plan directly, for a kid or the whole family', async () => {
    const { parent, circleId, kidId } = await family();
    const entry = await createPlanEntry(db, circleId, parent.id, { dateStr: '2026-11-27', mealText: 'Soup', kidProfileId: kidId });
    expect(typeof entry).toBe('object');
    const plan = (await listPlan(db, circleId, parent.id, '2026-11-27', '2026-11-27'))!;
    expect(plan.length).toBe(1);
    expect(plan[0].kidName).toBe('Sam');
  });
});

describe('scoping: other circles and other kids are invisible', () => {
  it('parent functions refuse a non-member on every new table', async () => {
    const a = await family();
    const stranger = await adult();
    expect(await listChores(db, a.circleId, stranger.id)).toBeNull();
    expect(await createChore(db, a.circleId, stranger.id, { kidProfileId: a.kidId, title: 'X', cadence: 'daily', points: 1 })).toBeNull();
    expect(await listPendingCompletions(db, a.circleId, stranger.id)).toBeNull();
    expect(await kidPoints(db, a.circleId, stranger.id, a.kidId)).toBeNull();
    expect(await adjustPoints(db, a.circleId, stranger.id, a.kidId, 5, 'sneaky')).toBeNull();
    expect(await listMealRequests(db, a.circleId, stranger.id)).toBeNull();
    expect(await listPlan(db, a.circleId, stranger.id, '2026-11-27', '2026-11-27')).toBeNull();
    expect(await listGroceries(db, a.circleId, stranger.id, [])).toBeNull();
  });

  it('a kid context touches only its own rows', async () => {
    const a = await family();
    const b = await family();
    const choreB = mustId(await createChore(db, b.circleId, b.parent.id, { kidProfileId: b.kidId, title: 'B chore', cadence: 'daily', points: 5 }));
    const rewardB = mustId(await createReward(db, b.circleId, b.parent.id, { title: 'B reward', costPoints: 1 }));
    const ctxA = await kidCtx(a.circleId, a.kidId, a.parent.id);
    expect(await kidMarkChore(db, ctxA, choreB, T0)).toBe('invalid');
    expect(await kidRequestRedemption(db, ctxA, rewardB)).toBe('invalid');
    expect(await kidMealRequest(db, ctxA, { favouriteId: mustId(await createFavourite(db, b.circleId, b.parent.id, 'B food')) })).toBe('invalid');
    // And the kid-safe projection carries no phone, no dietary notes, no admin fields.
    const self = await kidSelf(db, ctxA);
    expect(Object.keys(self!).sort()).toEqual(['avatarId', 'colour', 'firstName', 'id']);
  });

  it('dietary notes live on the parent side only', async () => {
    const parent = await adult();
    const c = await createCircle(db, parent.id, 'Notes Family', 'UTC');
    if (typeof c !== 'object') throw new Error('circle failed');
    const kid = await createKid(db, c.id, parent.id, {
      firstName: 'Nia', ageGroup: '3-5', avatarId: 'owl', colour: 'pink', phone: null, dietaryNotes: 'No peanuts',
    });
    const kids = (await listKids(db, c.id, parent.id))!;
    expect(kids[0].dietaryNotes).toBe('No peanuts');
    expect(typeof kid).toBe('object');
  });
});

describe('kid view PIN gate and sessions', () => {
  it('no PIN means the view is off; a wrong PIN is refused; five wrong tries lock it', async () => {
    const { parent, circleId, kidId } = await family();
    expect((await kidViewStatus(db, circleId, kidId)).hasPin).toBe(false);
    expect(await verifyKidPin(db, circleId, kidId, '1357', T0)).toBe('off');
    expect(await setKidPin(db, circleId, parent.id, kidId, '12')).toBe(false); // too short
    expect(await setKidPin(db, circleId, kidId, kidId, '1357')).toBe(false); // a kid id is not a member
    expect(await setKidPin(db, circleId, parent.id, kidId, '1357')).toBe(true);
    expect((await kidViewStatus(db, circleId, kidId)).hasPin).toBe(true);
    for (let i = 0; i < 4; i++) expect(await verifyKidPin(db, circleId, kidId, '9999', T0)).toBe('wrong');
    expect(await verifyKidPin(db, circleId, kidId, '9999', T0)).toBe('locked');
    expect(await verifyKidPin(db, circleId, kidId, '1357', T0)).toBe('locked'); // even the right PIN waits
    const later = new Date(T0.getTime() + 16 * 60_000);
    expect(await verifyKidPin(db, circleId, kidId, '1357', later)).toBe('ok');
  });

  it('a session is bound to one kid, expires, and dies when the PIN changes', async () => {
    const { parent, circleId, kidId } = await family();
    const other = await createKid(db, circleId, parent.id, { firstName: 'Jo', ageGroup: '9-12', avatarId: 'fox', colour: 'blue', phone: null });
    const otherId = mustId(other);
    await setKidPin(db, circleId, parent.id, kidId, '2468');
    const token = await createKidViewSession(db, circleId, kidId, T0);
    const ctx = await resolveKidView(db, token, T0);
    expect(ctx).toEqual({ circleId, kidProfileId: kidId });
    expect(ctx!.kidProfileId).not.toBe(otherId);
    expect(await resolveKidView(db, token, new Date(T0.getTime() + 13 * 60 * 60_000))).toBeNull(); // expired
    const token2 = await createKidViewSession(db, circleId, kidId, T0);
    expect(await resolveKidView(db, token2, T0)).not.toBeNull();
    await setKidPin(db, circleId, parent.id, kidId, '1357'); // replacing the PIN revokes sessions
    expect(await resolveKidView(db, token2, T0)).toBeNull();
    expect(await resolveKidView(db, 'not-a-real-token', T0)).toBeNull();
  });
});

describe('review regressions: concurrency, deletion, strict dates', () => {
  it('two concurrent redemption approvals cannot spend the same points twice', async () => {
    const { parent, circleId, kidId } = await family();
    const r1 = mustId(await createReward(db, circleId, parent.id, { title: 'Big one', costPoints: 50 }));
    const r2 = mustId(await createReward(db, circleId, parent.id, { title: 'Second', costPoints: 40 }));
    const ctx = await kidCtx(circleId, kidId, parent.id);
    await adjustPoints(db, circleId, parent.id, kidId, 90, 'Seed points');
    await kidRequestRedemption(db, ctx, r1);
    await kidRequestRedemption(db, ctx, r2);
    await adjustPoints(db, circleId, parent.id, kidId, -40, 'Spent some'); // balance now 50
    const pending = (await listPendingRedemptions(db, circleId, parent.id))!;
    expect(pending.length).toBe(2);
    const results = await Promise.all(pending.map((p) => decideRedemption(db, circleId, parent.id, p.id, true, T0)));
    expect(results.filter((x) => x === 'ok').length).toBe(1);
    expect(results.filter((x) => x === 'balance').length).toBe(1);
    const balance = await balanceOf(db, circleId, kidId);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(balance).toBeLessThanOrEqual(10);
  });

  it('a concurrent negative adjustment and redemption approval cannot both spend', async () => {
    const { parent, circleId, kidId } = await family();
    const rewardId = mustId(await createReward(db, circleId, parent.id, { title: 'Prize', costPoints: 50 }));
    const ctx = await kidCtx(circleId, kidId, parent.id);
    await adjustPoints(db, circleId, parent.id, kidId, 50, 'Seed points');
    await kidRequestRedemption(db, ctx, rewardId);
    const pending = (await listPendingRedemptions(db, circleId, parent.id))!;
    const [decision, adjustment] = await Promise.all([
      decideRedemption(db, circleId, parent.id, pending[0].id, true, T0),
      adjustPoints(db, circleId, parent.id, kidId, -50, 'Concurrent spend'),
    ]);
    const spent = (decision === 'ok' ? 1 : 0) + (adjustment === 'ok' ? 1 : 0);
    expect(spent).toBe(1);
    expect(await balanceOf(db, circleId, kidId)).toBe(0);
  });

  it('two concurrent requests for the same reward still make only one pending request', async () => {
    const { parent, circleId, kidId } = await family();
    const rewardId = mustId(await createReward(db, circleId, parent.id, { title: 'Prize', costPoints: 10 }));
    const ctx = await kidCtx(circleId, kidId, parent.id);
    await adjustPoints(db, circleId, parent.id, kidId, 20, 'Seed points');
    const results = await Promise.all([kidRequestRedemption(db, ctx, rewardId), kidRequestRedemption(db, ctx, rewardId)]);
    expect(results.sort()).toEqual(['already', 'ok']);
    expect((await listPendingRedemptions(db, circleId, parent.id))!.length).toBe(1);
  });

  it("deleting a member's account keeps their catalogue rows and every child's balance", async () => {
    const { parent, circleId, kidId } = await family();
    const member = await adult();
    await db.query("INSERT INTO hub_circle_members (circle_id, user_id, role) VALUES ($1, $2, 'member')", [circleId, member.id]);
    const choreId = mustId(await createChore(db, circleId, member.id, { kidProfileId: kidId, title: 'Member chore', cadence: 'daily', points: 7 }));
    mustId(await createReward(db, circleId, member.id, { title: 'Member reward', costPoints: 5 }));
    const ctx = await kidCtx(circleId, kidId, parent.id);
    await kidMarkChore(db, ctx, choreId, T0);
    const pending = (await listPendingCompletions(db, circleId, parent.id))!;
    await decideCompletion(db, circleId, parent.id, pending[0].id, true, T0);
    expect(await balanceOf(db, circleId, kidId)).toBe(7);
    await db.query('DELETE FROM accounts WHERE id = $1', [member.id]);
    expect(await balanceOf(db, circleId, kidId)).toBe(7); // the balance is untouched
    const chores = (await listChores(db, circleId, parent.id))!;
    expect(chores.some((c) => c.title === 'Member chore')).toBe(true); // the catalogue survives
    const rewards = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM hub_rewards WHERE circle_id = $1 AND title = 'Member reward'", [circleId]);
    expect(rewards.rows[0].n).toBe(1);
  });

  it('accepting a meal request with a nonsense date is invalid, not silently re-dated', async () => {
    const { parent, circleId, kidId } = await family();
    const ctx = await kidCtx(circleId, kidId, parent.id);
    await kidMealRequest(db, ctx, { text: 'Tacos' });
    const pending = (await listMealRequests(db, circleId, parent.id, 'pending'))!;
    expect(await decideMealRequest(db, circleId, parent.id, pending[0].id, { accept: true, dateStr: 'next friday-ish' }, T0)).toBe('invalid');
    expect((await listMealRequests(db, circleId, parent.id, 'pending'))!.length).toBe(1); // still waiting
  });
});
