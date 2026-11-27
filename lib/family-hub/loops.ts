// Family Hub Phase 2 data layer — the home loops (M3 chores & points, M4 meal planner).
// Two caller families, kept apart on purpose:
//  - Parent functions take an account id and check circle membership inside, exactly like
//    lib/family-hub/repo.ts (Phase 1): a non-member gets "does not exist".
//  - Kid functions take a KidViewContext from lib/family-hub/kid-session.ts — the (circle,
//    kid) pair bound to the kid-view token. They never see an account id and can only ever
//    touch that one kid's rows in that one circle.
// Points integrity: balances are sums over hub_points_ledger; points move only inside the
// transaction that flips a pending completion/redemption to approved, guarded on the
// pending state, so a double decision writes nothing twice.
// No Next.js imports. Verified by tests/unit/family-hub-phase2.test.ts and, for chore
// schedules and the weekly chart, tests/unit/family-hub-chore-schedules.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { isUuid } from '@/lib/accounts/pin';
import { listKids, listOccurrencesForKid, logActivity, memberRole, type Occurrence } from './repo';
import type { KidViewContext } from './kid-session';
import {
  DEFAULT_DECLINE_MESSAGE, LOOPS_LIMITS, WEEKDAY_FULL, cleanName, isChoreCadence, isDueOn, localDateString,
  mondayOf, nextDueDate, parseAdjustment, parseCost, parsePoints, parseScheduleDays, periodKeyFor, weekOf,
  weekdayIndex, zonedDayRange, type ChoreCadence,
} from './rules';

export type Chore = {
  id: string; kidProfileId: string; kidName: string; title: string; cadence: ChoreCadence;
  points: number; active: boolean; scheduleDays: number | null;
};
export type Completion = {
  id: string; choreId: string; choreTitle: string; points: number; kidProfileId: string; kidName: string;
  periodKey: string; state: 'pending' | 'approved' | 'declined'; markedAt: Date;
};
export type LedgerEntry = { id: string; delta: number; reason: string; note: string | null; createdAt: Date };
export type Reward = { id: string; title: string; costPoints: number; active: boolean };
export type Redemption = {
  id: string; rewardId: string; rewardTitle: string; costPoints: number; kidProfileId: string; kidName: string;
  state: 'pending' | 'approved' | 'declined'; requestedAt: Date;
};
export type Favourite = { id: string; title: string };
export type MealRequest = {
  id: string; kidProfileId: string; kidName: string; requestedText: string; desiredDay: string | null;
  state: 'pending' | 'accepted' | 'declined'; declineMessage: string | null; requestedAt: Date;
};
export type PlanEntry = { id: string; planDate: string; mealText: string; kidProfileId: string | null; kidName: string | null; sourceRequestId: string | null };
export type GroceryItem = { id: string; mealPlanId: string | null; itemText: string; quantityText: string | null; checked: boolean };

const isDateString = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  // Round-trip: JS Date rolls impossible dates over (2026-02-30 → Mar 2), so equality is
  // what makes it a real calendar date rather than a well-formed string.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

async function circleTz(db: Queryable, circleId: string): Promise<string> {
  const r = await db.query<{ time_zone: string }>('SELECT time_zone FROM hub_circles WHERE id = $1', [circleId]);
  return r.rows[0]?.time_zone ?? 'UTC';
}

async function kidName(db: Queryable, circleId: string, kidProfileId: string): Promise<string | null> {
  if (!isUuid(kidProfileId)) return null;
  const r = await db.query<{ first_name: string }>('SELECT first_name FROM hub_kid_profiles WHERE circle_id = $1 AND id = $2', [circleId, kidProfileId]);
  return r.rows[0]?.first_name ?? null;
}

export async function balanceOf(db: Queryable, circleId: string, kidProfileId: string): Promise<number> {
  const r = await db.query<{ total: number }>('SELECT COALESCE(SUM(delta), 0)::int AS total FROM hub_points_ledger WHERE circle_id = $1 AND kid_profile_id = $2', [circleId, kidProfileId]);
  return r.rows[0]?.total ?? 0;
}

// The per-kid serialisation point for every balance-spending transaction: locking the
// profile row means two decisions for the same kid can never check the same balance
// concurrently (READ COMMITTED alone would let both pass and drive it below zero).
async function lockKid(tx: Queryable, circleId: string, kidProfileId: string): Promise<boolean> {
  if (!isUuid(kidProfileId)) return false;
  const r = await tx.query('SELECT 1 FROM hub_kid_profiles WHERE circle_id = $1 AND id = $2 FOR UPDATE', [circleId, kidProfileId]);
  return r.rows.length === 1;
}

// ---- Chores (parent) ----

type ChoreRow = { id: string; kid_profile_id: string; first_name: string; title: string; cadence: ChoreCadence; points: number; active: boolean; schedule_days: number | null };
const choreOf = (x: ChoreRow): Chore => ({
  id: x.id, kidProfileId: x.kid_profile_id, kidName: x.first_name, title: x.title, cadence: x.cadence,
  points: x.points, active: x.active, scheduleDays: x.schedule_days,
});
const CHORE_COLS = 'c.id, c.kid_profile_id, k.first_name, c.title, c.cadence, c.points, c.active, c.schedule_days';

// The stored schedule_days for a cadence + raw form value: a specific-days chore MUST name
// at least one weekday (else 'invalid'); every other cadence stores NULL, whatever the form
// sent, so the column and the cadence can never disagree (migration 053 enforces it too).
function resolveScheduleDays(cadence: ChoreCadence, raw: unknown): number | null | 'invalid' {
  if (cadence !== 'specific_days') return null;
  return parseScheduleDays(raw) ?? 'invalid';
}

export async function listChores(db: Queryable, circleId: string, userId: string): Promise<Chore[] | null> {
  if (!(await memberRole(db, circleId, userId))) return null;
  const r = await db.query<ChoreRow>(
    `SELECT ${CHORE_COLS} FROM hub_chores c
     JOIN hub_kid_profiles k ON k.id = c.kid_profile_id WHERE c.circle_id = $1 ORDER BY k.first_name, c.created_at`,
    [circleId],
  );
  return r.rows.map(choreOf);
}

export async function createChore(
  db: Db, circleId: string, actorId: string,
  input: { kidProfileId: unknown; title: unknown; cadence: unknown; points: unknown; scheduleDays?: unknown },
): Promise<Chore | 'invalid' | 'limit' | null> {
  if (!(await memberRole(db, circleId, actorId))) return null;
  const title = cleanName(input.title, 80);
  const points = parsePoints(input.points);
  if (!title || !isChoreCadence(input.cadence) || points === null || !isUuid(input.kidProfileId)) return 'invalid';
  const scheduleDays = resolveScheduleDays(input.cadence, input.scheduleDays);
  if (scheduleDays === 'invalid') return 'invalid';
  const name = await kidName(db, circleId, input.kidProfileId);
  if (!name) return 'invalid';
  const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM hub_chores WHERE circle_id = $1 AND kid_profile_id = $2 AND active', [circleId, input.kidProfileId]);
  if ((count.rows[0]?.n ?? 0) >= LOOPS_LIMITS.choresPerKid) return 'limit';
  const r = await db.query<{ id: string }>(
    'INSERT INTO hub_chores (circle_id, kid_profile_id, title, cadence, points, schedule_days, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [circleId, input.kidProfileId, title, input.cadence, points, scheduleDays, actorId],
  );
  return { id: r.rows[0].id, kidProfileId: input.kidProfileId, kidName: name, title, cadence: input.cadence, points, active: true, scheduleDays };
}

// Editing a chore rewrites its title/points/schedule in place. Completions already recorded
// keep the period keys they were made under — changing the schedule shapes the future, it
// never rewrites a past approval.
export async function updateChore(
  db: Db, circleId: string, actorId: string, choreId: string,
  input: { title: unknown; cadence: unknown; points: unknown; scheduleDays?: unknown },
): Promise<'ok' | 'invalid' | null> {
  if (!isUuid(choreId) || !(await memberRole(db, circleId, actorId))) return null;
  const title = cleanName(input.title, 80);
  const points = parsePoints(input.points);
  if (!title || !isChoreCadence(input.cadence) || points === null) return 'invalid';
  const scheduleDays = resolveScheduleDays(input.cadence, input.scheduleDays);
  if (scheduleDays === 'invalid') return 'invalid';
  const r = await db.query(
    'UPDATE hub_chores SET title = $3, cadence = $4, points = $5, schedule_days = $6 WHERE circle_id = $1 AND id = $2',
    [circleId, choreId, title, input.cadence, points, scheduleDays],
  );
  return r.rowCount === 1 ? 'ok' : null;
}

export async function setChoreActive(db: Db, circleId: string, actorId: string, choreId: string, active: boolean): Promise<boolean> {
  if (!isUuid(choreId) || !(await memberRole(db, circleId, actorId))) return false;
  const r = await db.query('UPDATE hub_chores SET active = $3 WHERE circle_id = $1 AND id = $2', [circleId, choreId, active]);
  return r.rowCount === 1;
}

export async function listPendingCompletions(db: Queryable, circleId: string, userId: string): Promise<Completion[] | null> {
  if (!(await memberRole(db, circleId, userId))) return null;
  const r = await db.query<{ id: string; chore_id: string; title: string; points: number; kid_profile_id: string; first_name: string; period_key: string; marked_at: string }>(
    `SELECT cp.id, cp.chore_id, c.title, c.points, cp.kid_profile_id, k.first_name, cp.period_key, cp.marked_at
     FROM hub_chore_completions cp JOIN hub_chores c ON c.id = cp.chore_id JOIN hub_kid_profiles k ON k.id = cp.kid_profile_id
     WHERE cp.circle_id = $1 AND cp.state = 'pending' ORDER BY cp.marked_at`,
    [circleId],
  );
  return r.rows.map((x) => ({
    id: x.id, choreId: x.chore_id, choreTitle: x.title, points: x.points, kidProfileId: x.kid_profile_id,
    kidName: x.first_name, periodKey: x.period_key, state: 'pending' as const, markedAt: new Date(x.marked_at),
  }));
}

// The approval IS the points: the ledger row is written in the same transaction as the
// pending → approved flip, and the flip is guarded on state = 'pending', so approving twice
// (or approving a declined row) writes no points.
export async function decideCompletion(db: Db, circleId: string, actorId: string, completionId: string, approve: boolean, now: Date): Promise<boolean> {
  if (!isUuid(completionId) || !(await memberRole(db, circleId, actorId))) return false;
  return db.transaction(async (tx) => {
    const r = await tx.query<{ chore_id: string; kid_profile_id: string; state: string; title: string; points: number; first_name: string }>(
      `SELECT cp.chore_id, cp.kid_profile_id, cp.state, c.title, c.points, k.first_name FROM hub_chore_completions cp
       JOIN hub_chores c ON c.id = cp.chore_id JOIN hub_kid_profiles k ON k.id = cp.kid_profile_id
       WHERE cp.circle_id = $1 AND cp.id = $2 FOR UPDATE OF cp`,
      [circleId, completionId],
    );
    const row = r.rows[0];
    if (!row || row.state !== 'pending') return false;
    await tx.query('UPDATE hub_chore_completions SET state = $3, decided_by = $4, decided_at = $5 WHERE id = $1 AND circle_id = $2', [
      completionId, circleId, approve ? 'approved' : 'declined', actorId, now.toISOString(),
    ]);
    if (approve) {
      await tx.query(
        "INSERT INTO hub_points_ledger (circle_id, kid_profile_id, delta, reason, completion_id, created_by) VALUES ($1, $2, $3, 'chore_approval', $4, $5)",
        [circleId, row.kid_profile_id, row.points, completionId, actorId],
      );
    }
    await logActivity(tx, circleId, actorId, 'chore', approve ? `${row.first_name}'s “${row.title}” was approved — ${row.points} points.` : `${row.first_name}'s “${row.title}” was sent back.`);
    return true;
  });
}

// ---- The weekly chore chart (parent) ----

export type ChartEntry = { choreId: string; title: string; points: number; state: 'approved' | 'pending' | 'due' };
export type ChoreChart = {
  monday: string; days: string[]; today: string;
  rows: { kidId: string; kidName: string; cells: ChartEntry[][] }[];
};

// One Mon–Sun week of scheduled chores per kid, in the circle's timezone. A cell lists only
// chores SCHEDULED that day: daily chores every day, specific-days chores on their weekdays.
// Weekly and one-off chores have no fixed day, so they appear once: on the day they were
// marked, if they were marked this week (with that completion's state); a weekly chore not
// yet done this week sits on today's cell as 'due' (in the current week only). A declined
// mark reads as 'due' again — the kid can have another go. weekDate may be any date in the
// wanted week; null means the current week.
export async function choreChart(
  db: Queryable, circleId: string, userId: string, weekDate: string | null, now: Date,
): Promise<ChoreChart | null> {
  const chores = await listChores(db, circleId, userId);
  if (!chores) return null;
  const tz = await circleTz(db, circleId);
  const today = localDateString(now, tz);
  const monday = mondayOf(weekDate && isDateString(weekDate) ? weekDate : today);
  const days = weekOf(monday);
  const daySet = new Set(days);

  const roster = await listKids(db, circleId, userId);
  if (!roster) return null;
  const kids = roster.map((k) => ({ kidId: k.id, kidName: k.firstName }));

  // Every completion that can land in this week: daily/specific-days rows key by their date
  // and weekly rows by the week's Monday (both inside `days`); one-offs key 'once', so they
  // are placed by their marked day instead.
  const comp = await db.query<{ chore_id: string; period_key: string; state: 'pending' | 'approved' | 'declined'; marked_at: string }>(
    'SELECT chore_id, period_key, state, marked_at FROM hub_chore_completions WHERE circle_id = $1 AND (period_key = ANY($2::text[]) OR period_key = \'once\')',
    [circleId, days],
  );
  const byDate = new Map<string, 'approved' | 'pending' | 'declined'>(); // `${choreId}|${date}`
  const floating = new Map<string, { date: string; state: 'pending' | 'approved' | 'declined' }>(); // weekly/one-off, by choreId
  const choreById = new Map(chores.map((c) => [c.id, c]));
  for (const row of comp.rows) {
    const chore = choreById.get(row.chore_id);
    if (!chore) continue;
    if (chore.cadence === 'daily' || chore.cadence === 'specific_days') {
      if (daySet.has(row.period_key)) byDate.set(`${row.chore_id}|${row.period_key}`, row.state);
    } else {
      const markedDay = localDateString(new Date(row.marked_at), tz);
      if (daySet.has(markedDay)) floating.set(row.chore_id, { date: markedDay, state: row.state });
    }
  }
  const stateOf = (s: 'approved' | 'pending' | 'declined' | undefined): ChartEntry['state'] =>
    s === 'approved' ? 'approved' : s === 'pending' ? 'pending' : 'due';

  const rows = kids.map((k) => {
    const cells: ChartEntry[][] = days.map(() => []);
    for (const c of chores) {
      if (c.kidProfileId !== k.kidId || !c.active) continue;
      const entry = (state: ChartEntry['state']): ChartEntry => ({ choreId: c.id, title: c.title, points: c.points, state });
      if (c.cadence === 'daily' || c.cadence === 'specific_days') {
        days.forEach((d, i) => {
          if (isDueOn(c.cadence, c.scheduleDays, d)) cells[i].push(entry(stateOf(byDate.get(`${c.id}|${d}`))));
        });
      } else {
        const done = floating.get(c.id);
        if (done && done.state !== 'declined') {
          cells[days.indexOf(done.date)].push(entry(stateOf(done.state)));
        } else if (c.cadence === 'weekly' && daySet.has(today)) {
          cells[days.indexOf(today)].push(entry('due'));
        }
      }
    }
    for (const cell of cells) cell.sort((a, b) => a.title.localeCompare(b.title));
    return { kidId: k.kidId, kidName: k.kidName, cells };
  });
  return { monday, days, today, rows };
}

// ---- Points (parent) ----

export async function kidPoints(db: Queryable, circleId: string, userId: string, kidProfileId: string): Promise<number | null> {
  if (!(await memberRole(db, circleId, userId)) || !(await kidName(db, circleId, kidProfileId))) return null;
  return balanceOf(db, circleId, kidProfileId);
}

export async function listLedger(db: Queryable, circleId: string, userId: string, kidProfileId: string, limit = 15): Promise<LedgerEntry[] | null> {
  if (!(await memberRole(db, circleId, userId)) || !(await kidName(db, circleId, kidProfileId))) return null;
  const r = await db.query<{ id: string; delta: number; reason: string; note: string | null; created_at: string }>(
    'SELECT id, delta, reason, note, created_at FROM hub_points_ledger WHERE circle_id = $1 AND kid_profile_id = $2 ORDER BY created_at DESC LIMIT $3',
    [circleId, kidProfileId, Math.min(Math.max(limit, 1), 50)],
  );
  return r.rows.map((x) => ({ id: x.id, delta: x.delta, reason: x.reason, note: x.note, createdAt: new Date(x.created_at) }));
}

// A manual adjustment always carries the parent's reason and can never push a balance
// below zero — points are recognition, not a debt ledger.
export async function adjustPoints(
  db: Db, circleId: string, actorId: string, kidProfileId: string, deltaRaw: unknown, noteRaw: unknown,
): Promise<'ok' | 'invalid' | 'balance' | null> {
  if (!(await memberRole(db, circleId, actorId))) return null;
  const delta = parseAdjustment(deltaRaw);
  const note = typeof noteRaw === 'string' ? noteRaw.trim().slice(0, 300) : '';
  if (delta === null || note === '' || !(await kidName(db, circleId, kidProfileId))) return 'invalid';
  return db.transaction(async (tx) => {
    if (!(await lockKid(tx, circleId, kidProfileId))) return 'invalid' as const;
    const balance = await balanceOf(tx, circleId, kidProfileId);
    if (balance + delta < 0) return 'balance' as const;
    await tx.query(
      "INSERT INTO hub_points_ledger (circle_id, kid_profile_id, delta, reason, note, created_by) VALUES ($1, $2, $3, 'adjustment', $4, $5)",
      [circleId, kidProfileId, delta, note, actorId],
    );
    return 'ok' as const;
  });
}

// ---- Rewards (parent) ----

export async function listRewards(db: Queryable, circleId: string, userId: string): Promise<Reward[] | null> {
  if (!(await memberRole(db, circleId, userId))) return null;
  const r = await db.query<{ id: string; title: string; cost_points: number; active: boolean }>(
    'SELECT id, title, cost_points, active FROM hub_rewards WHERE circle_id = $1 ORDER BY active DESC, cost_points, created_at',
    [circleId],
  );
  return r.rows.map((x) => ({ id: x.id, title: x.title, costPoints: x.cost_points, active: x.active }));
}

export async function createReward(db: Db, circleId: string, actorId: string, input: { title: unknown; costPoints: unknown }): Promise<Reward | 'invalid' | 'limit' | null> {
  if (!(await memberRole(db, circleId, actorId))) return null;
  const title = cleanName(input.title, 80);
  const cost = parseCost(input.costPoints);
  if (!title || cost === null) return 'invalid';
  const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM hub_rewards WHERE circle_id = $1 AND active', [circleId]);
  if ((count.rows[0]?.n ?? 0) >= LOOPS_LIMITS.rewardsPerCircle) return 'limit';
  const r = await db.query<{ id: string }>('INSERT INTO hub_rewards (circle_id, title, cost_points, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [circleId, title, cost, actorId]);
  return { id: r.rows[0].id, title, costPoints: cost, active: true };
}

export async function setRewardActive(db: Db, circleId: string, actorId: string, rewardId: string, active: boolean): Promise<boolean> {
  if (!isUuid(rewardId) || !(await memberRole(db, circleId, actorId))) return false;
  const r = await db.query('UPDATE hub_rewards SET active = $3 WHERE circle_id = $1 AND id = $2', [circleId, rewardId, active]);
  return r.rowCount === 1;
}

export async function listPendingRedemptions(db: Queryable, circleId: string, userId: string): Promise<Redemption[] | null> {
  if (!(await memberRole(db, circleId, userId))) return null;
  const r = await db.query<{ id: string; reward_id: string; title: string; cost_points: number; kid_profile_id: string; first_name: string; requested_at: string }>(
    `SELECT rr.id, rr.reward_id, w.title, rr.cost_points, rr.kid_profile_id, k.first_name, rr.requested_at
     FROM hub_redemption_requests rr JOIN hub_rewards w ON w.id = rr.reward_id JOIN hub_kid_profiles k ON k.id = rr.kid_profile_id
     WHERE rr.circle_id = $1 AND rr.state = 'pending' ORDER BY rr.requested_at`,
    [circleId],
  );
  return r.rows.map((x) => ({
    id: x.id, rewardId: x.reward_id, rewardTitle: x.title, costPoints: x.cost_points, kidProfileId: x.kid_profile_id,
    kidName: x.first_name, state: 'pending' as const, requestedAt: new Date(x.requested_at),
  }));
}

// Approval spends the points: balance is re-checked inside the transaction (the balance at
// request time proves nothing), and the −cost ledger row is written with the flip.
export async function decideRedemption(db: Db, circleId: string, actorId: string, redemptionId: string, approve: boolean, now: Date): Promise<'ok' | 'balance' | false> {
  if (!isUuid(redemptionId) || !(await memberRole(db, circleId, actorId))) return false;
  return db.transaction(async (tx) => {
    const r = await tx.query<{ kid_profile_id: string; cost_points: number; state: string; title: string; first_name: string }>(
      `SELECT rr.kid_profile_id, rr.cost_points, rr.state, w.title, k.first_name FROM hub_redemption_requests rr
       JOIN hub_rewards w ON w.id = rr.reward_id JOIN hub_kid_profiles k ON k.id = rr.kid_profile_id
       WHERE rr.circle_id = $1 AND rr.id = $2 FOR UPDATE OF rr`,
      [circleId, redemptionId],
    );
    const row = r.rows[0];
    if (!row || row.state !== 'pending') return false as const;
    if (approve) {
      if (!(await lockKid(tx, circleId, row.kid_profile_id))) return false as const;
      const balance = await balanceOf(tx, circleId, row.kid_profile_id);
      if (balance < row.cost_points) return 'balance' as const;
      const led = await tx.query<{ id: string }>(
        "INSERT INTO hub_points_ledger (circle_id, kid_profile_id, delta, reason, redemption_id, created_by) VALUES ($1, $2, $3, 'reward_redemption', $4, $5) RETURNING id",
        [circleId, row.kid_profile_id, -row.cost_points, redemptionId, actorId],
      );
      await tx.query('UPDATE hub_redemption_requests SET state = \'approved\', decided_by = $3, decided_at = $4, ledger_entry_id = $5 WHERE id = $1 AND circle_id = $2', [
        redemptionId, circleId, actorId, now.toISOString(), led.rows[0].id,
      ]);
      await logActivity(tx, circleId, actorId, 'reward', `${row.first_name} earned “${row.title}” — ${row.cost_points} points spent.`);
      return 'ok' as const;
    }
    await tx.query('UPDATE hub_redemption_requests SET state = \'declined\', decided_by = $3, decided_at = $4 WHERE id = $1 AND circle_id = $2', [
      redemptionId, circleId, actorId, now.toISOString(),
    ]);
    await logActivity(tx, circleId, actorId, 'reward', `${row.first_name}'s reward request was sent back.`);
    return 'ok' as const;
  });
}

// ---- Favourites & meal requests ----

export async function listFavourites(db: Queryable, circleId: string, userId: string): Promise<Favourite[] | null> {
  if (!(await memberRole(db, circleId, userId))) return null;
  const r = await db.query<{ id: string; title: string }>('SELECT id, title FROM hub_favourite_meals WHERE circle_id = $1 ORDER BY title', [circleId]);
  return r.rows.map((x) => ({ id: x.id, title: x.title }));
}

export async function createFavourite(db: Db, circleId: string, actorId: string, titleRaw: unknown): Promise<Favourite | 'invalid' | 'limit' | null> {
  if (!(await memberRole(db, circleId, actorId))) return null;
  const title = cleanName(titleRaw, 80);
  if (!title) return 'invalid';
  const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM hub_favourite_meals WHERE circle_id = $1', [circleId]);
  if ((count.rows[0]?.n ?? 0) >= LOOPS_LIMITS.favouritesPerCircle) return 'limit';
  const r = await db.query<{ id: string }>('INSERT INTO hub_favourite_meals (circle_id, title, created_by) VALUES ($1, $2, $3) RETURNING id', [circleId, title, actorId]);
  return { id: r.rows[0].id, title };
}

export async function deleteFavourite(db: Db, circleId: string, actorId: string, favouriteId: string): Promise<boolean> {
  if (!isUuid(favouriteId) || !(await memberRole(db, circleId, actorId))) return false;
  const r = await db.query('DELETE FROM hub_favourite_meals WHERE circle_id = $1 AND id = $2', [circleId, favouriteId]);
  return r.rowCount === 1;
}

const mealRequestOf = (x: { id: string; kid_profile_id: string; first_name: string; requested_text: string; desired_day: string | null; state: 'pending' | 'accepted' | 'declined'; decline_message: string | null; requested_at: string }): MealRequest => ({
  id: x.id, kidProfileId: x.kid_profile_id, kidName: x.first_name, requestedText: x.requested_text,
  desiredDay: x.desired_day ? String(x.desired_day).slice(0, 10) : null, state: x.state,
  declineMessage: x.decline_message, requestedAt: new Date(x.requested_at),
});

export async function listMealRequests(db: Queryable, circleId: string, userId: string, state?: 'pending' | 'accepted' | 'declined'): Promise<MealRequest[] | null> {
  if (!(await memberRole(db, circleId, userId))) return null;
  const r = await db.query<{ id: string; kid_profile_id: string; first_name: string; requested_text: string; desired_day: string | null; state: 'pending' | 'accepted' | 'declined'; decline_message: string | null; requested_at: string }>(
    `SELECT mr.id, mr.kid_profile_id, k.first_name, mr.requested_text, mr.desired_day::text, mr.state, mr.decline_message, mr.requested_at
     FROM hub_meal_requests mr JOIN hub_kid_profiles k ON k.id = mr.kid_profile_id
     WHERE mr.circle_id = $1 ${state ? 'AND mr.state = $2' : ''} ORDER BY mr.requested_at DESC LIMIT 100`,
    state ? [circleId, state] : [circleId],
  );
  return r.rows.map(mealRequestOf);
}

// Accept: the request lands on the week board as a plan entry (one per request — the
// source_request_id is unique). Decline: the parent's message (or the kind default) is
// stored where the kid will see it in their view.
export async function decideMealRequest(
  db: Db, circleId: string, actorId: string, requestId: string,
  decision: { accept: boolean; dateStr?: unknown; declineMessage?: unknown }, now: Date,
): Promise<'accepted' | 'declined' | 'invalid' | 'limit' | false> {
  if (!isUuid(requestId) || !(await memberRole(db, circleId, actorId))) return false;
  // A date the parent actually typed must be a real date — never silently re-interpreted.
  if (decision.accept && typeof decision.dateStr === 'string' && decision.dateStr !== '' && !isDateString(decision.dateStr)) return 'invalid';
  return db.transaction(async (tx) => {
    const r = await tx.query<{ kid_profile_id: string; requested_text: string; desired_day: string | null; state: string; first_name: string }>(
      `SELECT mr.kid_profile_id, mr.requested_text, mr.desired_day::text, mr.state, k.first_name FROM hub_meal_requests mr
       JOIN hub_kid_profiles k ON k.id = mr.kid_profile_id WHERE mr.circle_id = $1 AND mr.id = $2 FOR UPDATE OF mr`,
      [circleId, requestId],
    );
    const row = r.rows[0];
    if (!row || row.state !== 'pending') return false as const;
    if (decision.accept) {
      const count = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM hub_meal_plan WHERE circle_id = $1', [circleId]);
      if ((count.rows[0]?.n ?? 0) >= LOOPS_LIMITS.planEntriesPerCircle) return 'limit' as const;
      const tz = await circleTz(tx, circleId);
      const planDate = isDateString(decision.dateStr) ? decision.dateStr : row.desired_day ? String(row.desired_day).slice(0, 10) : localDateString(now, tz);
      await tx.query('UPDATE hub_meal_requests SET state = \'accepted\', decided_by = $3, decided_at = $4 WHERE id = $1 AND circle_id = $2', [
        requestId, circleId, actorId, now.toISOString(),
      ]);
      await tx.query(
        'INSERT INTO hub_meal_plan (circle_id, plan_date, meal_text, kid_profile_id, source_request_id, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [circleId, planDate, row.requested_text, row.kid_profile_id, requestId, actorId],
      );
      await logActivity(tx, circleId, actorId, 'meal', `${row.requested_text} is on the plan for ${row.first_name} (${planDate}).`);
      return 'accepted' as const;
    }
    const message = typeof decision.declineMessage === 'string' && decision.declineMessage.trim() !== ''
      ? decision.declineMessage.trim().slice(0, 300)
      : DEFAULT_DECLINE_MESSAGE;
    await tx.query('UPDATE hub_meal_requests SET state = \'declined\', decline_message = $3, decided_by = $4, decided_at = $5 WHERE id = $1 AND circle_id = $2', [
      requestId, circleId, message, actorId, now.toISOString(),
    ]);
    await logActivity(tx, circleId, actorId, 'meal', `${row.first_name}'s meal request was sent back with a note.`);
    return 'declined' as const;
  });
}

// ---- Week board & groceries ----

export async function listPlan(db: Queryable, circleId: string, userId: string, fromDate: string, toDate: string): Promise<PlanEntry[] | null> {
  if (!(await memberRole(db, circleId, userId)) || !isDateString(fromDate) || !isDateString(toDate)) return null;
  const r = await db.query<{ id: string; plan_date: string; meal_text: string; kid_profile_id: string | null; first_name: string | null; source_request_id: string | null }>(
    `SELECT p.id, p.plan_date::text, p.meal_text, p.kid_profile_id, k.first_name, p.source_request_id FROM hub_meal_plan p
     LEFT JOIN hub_kid_profiles k ON k.id = p.kid_profile_id WHERE p.circle_id = $1 AND p.plan_date >= $2 AND p.plan_date <= $3
     ORDER BY p.plan_date, p.created_at`,
    [circleId, fromDate, toDate],
  );
  return r.rows.map((x) => ({
    id: x.id, planDate: String(x.plan_date).slice(0, 10), mealText: x.meal_text, kidProfileId: x.kid_profile_id,
    kidName: x.first_name, sourceRequestId: x.source_request_id,
  }));
}

export async function createPlanEntry(
  db: Db, circleId: string, actorId: string,
  input: { dateStr: unknown; mealText: unknown; kidProfileId?: unknown },
): Promise<PlanEntry | 'invalid' | 'limit' | null> {
  if (!(await memberRole(db, circleId, actorId))) return null;
  const mealText = cleanName(input.mealText, 80);
  if (!mealText || !isDateString(input.dateStr)) return 'invalid';
  let kidId: string | null = null;
  let kidNameValue: string | null = null;
  if (input.kidProfileId !== undefined && input.kidProfileId !== null && input.kidProfileId !== '') {
    if (!isUuid(input.kidProfileId)) return 'invalid';
    kidNameValue = await kidName(db, circleId, input.kidProfileId);
    if (!kidNameValue) return 'invalid';
    kidId = input.kidProfileId;
  }
  const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM hub_meal_plan WHERE circle_id = $1', [circleId]);
  if ((count.rows[0]?.n ?? 0) >= LOOPS_LIMITS.planEntriesPerCircle) return 'limit';
  const r = await db.query<{ id: string }>(
    'INSERT INTO hub_meal_plan (circle_id, plan_date, meal_text, kid_profile_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [circleId, input.dateStr, mealText, kidId, actorId],
  );
  return { id: r.rows[0].id, planDate: input.dateStr, mealText, kidProfileId: kidId, kidName: kidNameValue, sourceRequestId: null };
}

export async function deletePlanEntry(db: Db, circleId: string, actorId: string, planId: string): Promise<boolean> {
  if (!isUuid(planId) || !(await memberRole(db, circleId, actorId))) return false;
  const r = await db.query('DELETE FROM hub_meal_plan WHERE circle_id = $1 AND id = $2', [circleId, planId]);
  return r.rowCount === 1;
}

export async function listGroceries(db: Queryable, circleId: string, userId: string, planIds: string[]): Promise<GroceryItem[] | null> {
  if (!(await memberRole(db, circleId, userId))) return null;
  const ids = planIds.filter(isUuid);
  const r = await db.query<{ id: string; meal_plan_id: string | null; item_text: string; quantity_text: string | null; checked: boolean }>(
    `SELECT id, meal_plan_id, item_text, quantity_text, checked FROM hub_grocery_items
     WHERE circle_id = $1 AND (meal_plan_id IS NULL OR meal_plan_id = ANY($2::uuid[])) ORDER BY checked, created_at`,
    [circleId, ids],
  );
  return r.rows.map((x) => ({ id: x.id, mealPlanId: x.meal_plan_id, itemText: x.item_text, quantityText: x.quantity_text, checked: x.checked }));
}

export async function addGroceryItem(
  db: Db, circleId: string, actorId: string,
  input: { mealPlanId?: unknown; itemText: unknown; quantityText?: unknown },
): Promise<GroceryItem | 'invalid' | 'limit' | null> {
  if (!(await memberRole(db, circleId, actorId))) return null;
  const itemText = cleanName(input.itemText, 80);
  if (!itemText) return 'invalid';
  const quantityText = input.quantityText === undefined || input.quantityText === null || input.quantityText === ''
    ? null
    : cleanName(input.quantityText, 40);
  if (input.quantityText && quantityText === null) return 'invalid';
  let planId: string | null = null;
  if (input.mealPlanId !== undefined && input.mealPlanId !== null && input.mealPlanId !== '') {
    if (!isUuid(input.mealPlanId)) return 'invalid';
    const p = await db.query('SELECT 1 FROM hub_meal_plan WHERE circle_id = $1 AND id = $2', [circleId, input.mealPlanId]);
    if (p.rows.length !== 1) return 'invalid';
    planId = input.mealPlanId;
  }
  const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM hub_grocery_items WHERE circle_id = $1', [circleId]);
  if ((count.rows[0]?.n ?? 0) >= LOOPS_LIMITS.groceryItemsPerCircle) return 'limit';
  const r = await db.query<{ id: string }>(
    'INSERT INTO hub_grocery_items (circle_id, meal_plan_id, item_text, quantity_text, added_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [circleId, planId, itemText, quantityText, actorId],
  );
  return { id: r.rows[0].id, mealPlanId: planId, itemText, quantityText, checked: false };
}

export async function setGroceryChecked(db: Db, circleId: string, actorId: string, itemId: string, checked: boolean): Promise<boolean> {
  if (!isUuid(itemId) || !(await memberRole(db, circleId, actorId))) return false;
  const r = await db.query('UPDATE hub_grocery_items SET checked = $3 WHERE circle_id = $1 AND id = $2', [circleId, itemId, checked]);
  return r.rowCount === 1;
}

export async function deleteGroceryItem(db: Db, circleId: string, actorId: string, itemId: string): Promise<boolean> {
  if (!isUuid(itemId) || !(await memberRole(db, circleId, actorId))) return false;
  const r = await db.query('DELETE FROM hub_grocery_items WHERE circle_id = $1 AND id = $2', [circleId, itemId]);
  return r.rowCount === 1;
}

// ---- Kid view (the context is the credential; no account anywhere below) ----

export type KidSelf = { id: string; firstName: string; avatarId: string; colour: string };

export async function kidSelf(db: Queryable, ctx: KidViewContext): Promise<KidSelf | null> {
  const r = await db.query<{ id: string; first_name: string; avatar_id: string; colour: string }>(
    'SELECT id, first_name, avatar_id, colour FROM hub_kid_profiles WHERE circle_id = $1 AND id = $2',
    [ctx.circleId, ctx.kidProfileId],
  );
  const x = r.rows[0];
  return x ? { id: x.id, firstName: x.first_name, avatarId: x.avatar_id, colour: x.colour } : null;
}

export async function kidDay(db: Queryable, ctx: KidViewContext, now: Date): Promise<{ events: Occurrence[]; timeZone: string }> {
  const tz = await circleTz(db, ctx.circleId);
  const { from, to } = zonedDayRange(now, tz);
  const events = await listOccurrencesForKid(db, ctx.circleId, ctx.kidProfileId, from, to);
  return { events, timeZone: tz };
}

export type KidChore = {
  chore: Chore; periodKey: string; state: 'pending' | 'approved' | 'declined' | null;
  // Schedule awareness: dueToday says whether the chore can be marked right now; for a
  // specific-days chore on an off day, nextDueWeekday names the next due day ('Saturday')
  // so the kid view can teach the schedule instead of just hiding the chore.
  dueToday: boolean; nextDueWeekday: string | null;
};

export async function kidChores(db: Queryable, ctx: KidViewContext, now: Date): Promise<KidChore[]> {
  const tz = await circleTz(db, ctx.circleId);
  const name = await kidName(db, ctx.circleId, ctx.kidProfileId);
  if (!name) return [];
  const r = await db.query<{ id: string; title: string; cadence: ChoreCadence; points: number; schedule_days: number | null }>(
    'SELECT id, title, cadence, points, schedule_days FROM hub_chores WHERE circle_id = $1 AND kid_profile_id = $2 AND active ORDER BY created_at',
    [ctx.circleId, ctx.kidProfileId],
  );
  const today = localDateString(now, tz);
  const out: KidChore[] = [];
  for (const c of r.rows) {
    const periodKey = periodKeyFor(c.cadence, now, tz);
    const comp = await db.query<{ state: 'pending' | 'approved' | 'declined' }>(
      'SELECT state FROM hub_chore_completions WHERE chore_id = $1 AND period_key = $2',
      [c.id, periodKey],
    );
    const dueToday = isDueOn(c.cadence, c.schedule_days, today);
    const next = dueToday ? null : nextDueDate(c.cadence, c.schedule_days, today);
    out.push({
      chore: { id: c.id, kidProfileId: ctx.kidProfileId, kidName: name, title: c.title, cadence: c.cadence, points: c.points, active: true, scheduleDays: c.schedule_days },
      periodKey,
      state: comp.rows[0]?.state ?? null,
      dueToday,
      nextDueWeekday: next ? WEEKDAY_FULL[weekdayIndex(next)] : null,
    });
  }
  // Due chores first (stable: creation order kept inside each group) so today's work leads.
  return out.sort((a, b) => Number(b.dueToday) - Number(a.dueToday));
}

// Marking a chore creates a PENDING completion and nothing else — points exist only after
// a parent approves (decideCompletion). A declined mark for the same period can be re-marked
// (the kid may have gone back and done it); a pending or approved one cannot be doubled.
// A specific-days chore marked on a day it is not scheduled returns 'notdue' and writes
// nothing — the schedule is the rule, not a suggestion the server waves through.
export async function kidMarkChore(db: Db, ctx: KidViewContext, choreId: string, now: Date): Promise<'marked' | 'already' | 'invalid' | 'notdue'> {
  if (!isUuid(choreId)) return 'invalid';
  const tz = await circleTz(db, ctx.circleId);
  const c = await db.query<{ title: string; cadence: ChoreCadence; schedule_days: number | null }>(
    'SELECT title, cadence, schedule_days FROM hub_chores WHERE circle_id = $1 AND kid_profile_id = $2 AND id = $3 AND active',
    [ctx.circleId, ctx.kidProfileId, choreId],
  );
  const chore = c.rows[0];
  if (!chore) return 'invalid';
  if (!isDueOn(chore.cadence, chore.schedule_days, localDateString(now, tz))) return 'notdue';
  const periodKey = periodKeyFor(chore.cadence, now, tz);
  const r = await db.query(
    `INSERT INTO hub_chore_completions (chore_id, circle_id, kid_profile_id, period_key) VALUES ($1, $2, $3, $4)
     ON CONFLICT (chore_id, period_key) DO UPDATE SET state = 'pending', decided_by = NULL, decided_at = NULL, marked_at = now()
     WHERE hub_chore_completions.state = 'declined'
     RETURNING id`,
    [choreId, ctx.circleId, ctx.kidProfileId, periodKey],
  );
  if (r.rowCount !== 1) return 'already';
  const name = await kidName(db, ctx.circleId, ctx.kidProfileId);
  await logActivity(db, ctx.circleId, null, 'chore', `${name ?? 'A kid'} marked “${chore.title}” done — waiting for a grown-up.`);
  return 'marked';
}

export async function kidRewards(db: Queryable, ctx: KidViewContext): Promise<{ balance: number; rewards: Reward[]; mine: Redemption[] }> {
  const balance = await balanceOf(db, ctx.circleId, ctx.kidProfileId);
  const r = await db.query<{ id: string; title: string; cost_points: number; active: boolean }>(
    'SELECT id, title, cost_points, active FROM hub_rewards WHERE circle_id = $1 AND active ORDER BY cost_points, created_at',
    [ctx.circleId],
  );
  const mine = await db.query<{ id: string; reward_id: string; title: string; cost_points: number; first_name: string; state: 'pending' | 'approved' | 'declined'; requested_at: string }>(
    `SELECT rr.id, rr.reward_id, w.title, rr.cost_points, k.first_name, rr.state, rr.requested_at FROM hub_redemption_requests rr
     JOIN hub_rewards w ON w.id = rr.reward_id JOIN hub_kid_profiles k ON k.id = rr.kid_profile_id
     WHERE rr.circle_id = $1 AND rr.kid_profile_id = $2 ORDER BY rr.requested_at DESC LIMIT 10`,
    [ctx.circleId, ctx.kidProfileId],
  );
  return {
    balance,
    rewards: r.rows.map((x) => ({ id: x.id, title: x.title, costPoints: x.cost_points, active: x.active })),
    mine: mine.rows.map((x) => ({
      id: x.id, rewardId: x.reward_id, rewardTitle: x.title, costPoints: x.cost_points, kidProfileId: ctx.kidProfileId,
      kidName: x.first_name, state: x.state, requestedAt: new Date(x.requested_at),
    })),
  };
}

export async function kidRequestRedemption(db: Db, ctx: KidViewContext, rewardId: string): Promise<'ok' | 'balance' | 'already' | 'invalid'> {
  if (!isUuid(rewardId)) return 'invalid';
  return db.transaction(async (tx) => {
    if (!(await lockKid(tx, ctx.circleId, ctx.kidProfileId))) return 'invalid' as const;
    const w = await tx.query<{ title: string; cost_points: number }>('SELECT title, cost_points FROM hub_rewards WHERE circle_id = $1 AND id = $2 AND active', [ctx.circleId, rewardId]);
    const reward = w.rows[0];
    if (!reward) return 'invalid' as const;
    const dup = await tx.query("SELECT 1 FROM hub_redemption_requests WHERE circle_id = $1 AND kid_profile_id = $2 AND reward_id = $3 AND state = 'pending'", [ctx.circleId, ctx.kidProfileId, rewardId]);
    if (dup.rows.length > 0) return 'already' as const;
    const balance = await balanceOf(tx, ctx.circleId, ctx.kidProfileId);
    if (balance < reward.cost_points) return 'balance' as const;
    await tx.query('INSERT INTO hub_redemption_requests (circle_id, kid_profile_id, reward_id, cost_points) VALUES ($1, $2, $3, $4)', [
      ctx.circleId, ctx.kidProfileId, rewardId, reward.cost_points,
    ]);
    const name = await kidName(tx, ctx.circleId, ctx.kidProfileId);
    await logActivity(tx, ctx.circleId, null, 'reward', `${name ?? 'A kid'} asked for the reward “${reward.title}”.`);
    return 'ok' as const;
  });
}

export async function kidMealRequest(
  db: Db, ctx: KidViewContext,
  input: { favouriteId?: unknown; text?: unknown; desiredDay?: unknown },
): Promise<'ok' | 'invalid' | 'limit'> {
  let text: string | null = null;
  let favouriteId: string | null = null;
  if (typeof input.favouriteId === 'string' && input.favouriteId !== '') {
    if (!isUuid(input.favouriteId)) return 'invalid';
    const fav = await db.query<{ title: string }>('SELECT title FROM hub_favourite_meals WHERE circle_id = $1 AND id = $2', [ctx.circleId, input.favouriteId]);
    if (!fav.rows[0]) return 'invalid';
    text = fav.rows[0].title;
    favouriteId = input.favouriteId;
  } else {
    text = cleanName(input.text, 80);
    if (!text) return 'invalid';
  }
  const desiredDay = input.desiredDay === undefined || input.desiredDay === null || input.desiredDay === '' ? null : isDateString(input.desiredDay) ? input.desiredDay : undefined;
  if (desiredDay === undefined) return 'invalid';
  const pending = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM hub_meal_requests WHERE circle_id = $1 AND kid_profile_id = $2 AND state = 'pending'", [ctx.circleId, ctx.kidProfileId]);
  if ((pending.rows[0]?.n ?? 0) >= LOOPS_LIMITS.pendingMealRequestsPerKid) return 'limit';
  await db.query(
    'INSERT INTO hub_meal_requests (circle_id, kid_profile_id, favourite_id, requested_text, desired_day) VALUES ($1, $2, $3, $4, $5)',
    [ctx.circleId, ctx.kidProfileId, favouriteId, text, desiredDay],
  );
  const name = await kidName(db, ctx.circleId, ctx.kidProfileId);
  await logActivity(db, ctx.circleId, null, 'meal', `${name ?? 'A kid'} requested “${text}” for dinner.`);
  return 'ok';
}

export async function kidMealRequests(db: Queryable, ctx: KidViewContext): Promise<MealRequest[]> {
  const r = await db.query<{ id: string; kid_profile_id: string; first_name: string; requested_text: string; desired_day: string | null; state: 'pending' | 'accepted' | 'declined'; decline_message: string | null; requested_at: string }>(
    `SELECT mr.id, mr.kid_profile_id, k.first_name, mr.requested_text, mr.desired_day::text, mr.state, mr.decline_message, mr.requested_at
     FROM hub_meal_requests mr JOIN hub_kid_profiles k ON k.id = mr.kid_profile_id
     WHERE mr.circle_id = $1 AND mr.kid_profile_id = $2 ORDER BY mr.requested_at DESC LIMIT 10`,
    [ctx.circleId, ctx.kidProfileId],
  );
  return r.rows.map(mealRequestOf);
}

export async function kidFavourites(db: Queryable, ctx: KidViewContext): Promise<Favourite[]> {
  const r = await db.query<{ id: string; title: string }>('SELECT id, title FROM hub_favourite_meals WHERE circle_id = $1 ORDER BY title', [ctx.circleId]);
  return r.rows.map((x) => ({ id: x.id, title: x.title }));
}
