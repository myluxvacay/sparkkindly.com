// @vitest-environment node
// Family Hub chore schedules (migration 053): specific-weekday chores on top of the Phase 2
// cadences. The invariants under test: due-ness is computed on the CIRCLE's calendar, never
// the server's; a specific-days chore can be marked only on a due day, once per due day; the
// weekly chart shows what was scheduled, in the state it is actually in.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { createCircle, createKid } from '@/lib/family-hub/repo';
import {
  choreChart, createChore, decideCompletion, kidChores, kidMarkChore, kidPoints,
  listChores, listPendingCompletions, updateChore,
} from '@/lib/family-hub/loops';
import {
  createKidViewSession, resolveKidView, setKidPin, verifyKidPin, type KidViewContext,
} from '@/lib/family-hub/kid-session';
import {
  isDueOn, nextDueDate, parseScheduleDays, periodKeyFor, scheduleLabel, weekdayBit,
} from '@/lib/family-hub/rules';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let n = 0;

// All in America/New_York (EST, UTC-5): Fri Nov 27 2026 is the week's pivot day.
const THU = new Date('2026-11-26T17:00:00Z'); // Thu Nov 26, noon local
const THU_LATE = new Date('2026-11-27T04:30:00Z'); // Thu Nov 26, 23:30 local — already Friday in UTC
const FRI_EARLY = new Date('2026-11-27T05:30:00Z'); // Fri Nov 27, 00:30 local
const FRI = new Date('2026-11-27T17:00:00Z'); // Fri Nov 27, noon local
const SAT = new Date('2026-11-28T17:00:00Z');
const SUN = new Date('2026-11-29T17:00:00Z');
const MON = new Date('2026-11-30T17:00:00Z');

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

async function adult(): Promise<{ id: string; email: string }> {
  const email = `sched-${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: '1990-05-05' }, FRI);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return { id: r.accountId, email };
}

async function family(): Promise<{ parent: { id: string }; circleId: string; kidId: string }> {
  const parent = await adult();
  const c = await createCircle(db, parent.id, 'The Schedule Family', 'America/New_York');
  if (typeof c !== 'object') throw new Error('circle failed');
  const kid = await createKid(db, c.id, parent.id, { firstName: 'Sam', ageGroup: '6-8', avatarId: 'dog', colour: 'teal', phone: null });
  if (typeof kid !== 'object' || kid === null || !('id' in kid)) throw new Error('kid failed');
  return { parent, circleId: c.id, kidId: kid.id };
}

async function kidCtx(circleId: string, kidId: string, parentId: string): Promise<KidViewContext> {
  if (!(await setKidPin(db, circleId, parentId, kidId, '1357'))) throw new Error('pin set failed');
  if ((await verifyKidPin(db, circleId, kidId, '1357', FRI)) !== 'ok') throw new Error('pin verify failed');
  const token = await createKidViewSession(db, circleId, kidId, FRI);
  const ctx = await resolveKidView(db, token, FRI);
  if (!ctx) throw new Error('kid session failed');
  return ctx;
}

const mustId = (r: unknown): string => {
  if (typeof r !== 'object' || r === null || !('id' in r)) throw new Error('expected an id result');
  return (r as { id: string }).id;
};

describe('rules: weekday bits, parsing, due-ness', () => {
  it('maps dates to bits Mon=1 … Sun=64', () => {
    expect(weekdayBit('2026-11-23')).toBe(1); // Monday
    expect(weekdayBit('2026-11-27')).toBe(16); // Friday
    expect(weekdayBit('2026-11-29')).toBe(64); // Sunday
  });

  it('parses form values into a mask and refuses junk', () => {
    expect(parseScheduleDays(['5', '6'])).toBe(48);
    expect(parseScheduleDays([1])).toBe(1);
    expect(parseScheduleDays(48)).toBe(48);
    expect(parseScheduleDays([])).toBeNull();
    expect(parseScheduleDays(['0'])).toBeNull();
    expect(parseScheduleDays(['8'])).toBeNull();
    expect(parseScheduleDays(['fri'])).toBeNull();
    expect(parseScheduleDays(0)).toBeNull();
    expect(parseScheduleDays(128)).toBeNull();
    expect(parseScheduleDays(undefined)).toBeNull();
  });

  it('computes due days and the next due day, across the week boundary', () => {
    const friSat = 16 | 32;
    expect(isDueOn('specific_days', friSat, '2026-11-27')).toBe(true);
    expect(isDueOn('specific_days', friSat, '2026-11-26')).toBe(false);
    expect(isDueOn('daily', null, '2026-11-26')).toBe(true);
    expect(isDueOn('specific_days', null, '2026-11-27')).toBe(false);
    expect(nextDueDate('specific_days', friSat, '2026-11-26')).toBe('2026-11-27');
    expect(nextDueDate('specific_days', friSat, '2026-11-28')).toBe('2026-12-04'); // next Friday
    expect(nextDueDate('specific_days', 64, '2026-11-29')).toBe('2026-12-06'); // Sunday → next Sunday
    expect(nextDueDate('daily', null, '2026-11-26')).toBeNull();
  });

  it('keys specific-days periods by the circle-local date', () => {
    expect(periodKeyFor('specific_days', FRI, 'America/New_York')).toBe('2026-11-27');
    expect(periodKeyFor('specific_days', THU_LATE, 'America/New_York')).toBe('2026-11-26');
    expect(periodKeyFor('specific_days', THU_LATE, 'UTC')).toBe('2026-11-27');
  });

  it('labels schedules in words', () => {
    expect(scheduleLabel('specific_days', 16 | 32)).toBe('Fri · Sat');
    expect(scheduleLabel('specific_days', 1 | 64)).toBe('Mon · Sun');
    expect(scheduleLabel('daily', null)).toBe('Every day');
    expect(scheduleLabel('weekly', null)).toBe('Every week');
  });
});

describe('create and edit: the schedule is validated as a pair', () => {
  it('a specific-days chore needs at least one day; other cadences store no days', async () => {
    const { parent, circleId, kidId } = await family();
    expect(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Bins', cadence: 'specific_days', points: 5 })).toBe('invalid');
    expect(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Bins', cadence: 'specific_days', points: 5, scheduleDays: [] })).toBe('invalid');
    const made = await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Bins', cadence: 'specific_days', points: 5, scheduleDays: ['5', '6'] });
    expect(typeof made).toBe('object');
    const daily = await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Dishes', cadence: 'daily', points: 5, scheduleDays: ['5'] });
    expect(typeof daily).toBe('object');
    const chores = (await listChores(db, circleId, parent.id))!;
    expect(chores.find((c) => c.title === 'Bins')?.scheduleDays).toBe(48);
    expect(chores.find((c) => c.title === 'Dishes')?.scheduleDays).toBeNull();
  });

  it('the database itself refuses a cadence/days mismatch', async () => {
    const { parent, circleId, kidId } = await family();
    await expect(
      db.query("INSERT INTO hub_chores (circle_id, kid_profile_id, title, cadence, points, schedule_days) VALUES ($1, $2, 'X', 'daily', 5, 16)", [circleId, kidId]),
    ).rejects.toThrow();
    await expect(
      db.query("INSERT INTO hub_chores (circle_id, kid_profile_id, title, cadence, points, schedule_days) VALUES ($1, $2, 'X', 'specific_days', 5, NULL)", [circleId, kidId]),
    ).rejects.toThrow();
    void parent;
  });

  it('editing moves a chore onto specific days, with the same validation', async () => {
    const { parent, circleId, kidId } = await family();
    const choreId = mustId(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Plants', cadence: 'daily', points: 5 }));
    expect(await updateChore(db, circleId, parent.id, choreId, { title: 'Plants', cadence: 'specific_days', points: 5 })).toBe('invalid');
    expect(await updateChore(db, circleId, parent.id, choreId, { title: 'Water plants', cadence: 'specific_days', points: 8, scheduleDays: ['6'] })).toBe('ok');
    const chores = (await listChores(db, circleId, parent.id))!;
    const edited = chores.find((c) => c.id === choreId)!;
    expect(edited.title).toBe('Water plants');
    expect(edited.cadence).toBe('specific_days');
    expect(edited.scheduleDays).toBe(32);
    expect(edited.points).toBe(8);
    const stranger = await adult();
    expect(await updateChore(db, circleId, stranger.id, choreId, { title: 'Nope', cadence: 'daily', points: 1 })).toBeNull();
  });
});

describe('due days: marking follows the circle calendar', () => {
  it('a Fri+Sat chore is due on Friday in New York — not on Thursday, even late Thursday UTC', async () => {
    const { parent, circleId, kidId } = await family();
    const choreId = mustId(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Bins out', cadence: 'specific_days', points: 10, scheduleDays: ['5', '6'] }));
    const ctx = await kidCtx(circleId, kidId, parent.id);

    const thu = (await kidChores(db, ctx, THU)).find((k) => k.chore.id === choreId)!;
    expect(thu.dueToday).toBe(false);
    expect(thu.nextDueWeekday).toBe('Friday');
    const thuLate = (await kidChores(db, ctx, THU_LATE)).find((k) => k.chore.id === choreId)!;
    expect(thuLate.dueToday).toBe(false); // 23:30 in New York: still Thursday there
    const friEarly = (await kidChores(db, ctx, FRI_EARLY)).find((k) => k.chore.id === choreId)!;
    expect(friEarly.dueToday).toBe(true);

    expect(await kidMarkChore(db, ctx, choreId, THU)).toBe('notdue');
    expect((await listPendingCompletions(db, circleId, parent.id))!.length).toBe(0); // nothing written

    expect(await kidMarkChore(db, ctx, choreId, FRI)).toBe('marked');
    expect(await kidMarkChore(db, ctx, choreId, FRI)).toBe('already'); // once per due day
    expect(await kidMarkChore(db, ctx, choreId, SAT)).toBe('marked'); // Saturday is a new period
    const pending = (await listPendingCompletions(db, circleId, parent.id))!;
    expect(pending.map((p) => p.periodKey).sort()).toEqual(['2026-11-27', '2026-11-28']);

    const friPending = pending.find((p) => p.periodKey === '2026-11-27')!;
    expect(await decideCompletion(db, circleId, parent.id, friPending.id, true, FRI)).toBe(true);
    expect(await kidPoints(db, circleId, parent.id, kidId)).toBe(10);
    const satView = (await kidChores(db, ctx, SAT)).find((k) => k.chore.id === choreId)!;
    expect(satView.dueToday).toBe(true);
    expect(satView.state).toBe('pending');
  });

  it('a Sunday-only chore crosses the week boundary cleanly', async () => {
    const { parent, circleId, kidId } = await family();
    const choreId = mustId(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Call grandma', cadence: 'specific_days', points: 5, scheduleDays: ['7'] }));
    const ctx = await kidCtx(circleId, kidId, parent.id);
    const sat = (await kidChores(db, ctx, SAT)).find((k) => k.chore.id === choreId)!;
    expect(sat.dueToday).toBe(false);
    expect(sat.nextDueWeekday).toBe('Sunday');
    expect(await kidMarkChore(db, ctx, choreId, SUN)).toBe('marked');
    const pending = (await listPendingCompletions(db, circleId, parent.id))!;
    expect(pending[0].periodKey).toBe('2026-11-29');
    const mon = (await kidChores(db, ctx, MON)).find((k) => k.chore.id === choreId)!;
    expect(mon.dueToday).toBe(false);
    expect(mon.nextDueWeekday).toBe('Sunday');
  });
});

describe('the weekly chart', () => {
  it('shows a mixed week truthfully: scheduled days, states, and placements', async () => {
    const { parent, circleId, kidId } = await family();
    const dishes = mustId(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Dishes', cadence: 'daily', points: 5 }));
    const cat = mustId(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Feed the cat', cadence: 'specific_days', points: 10, scheduleDays: ['5', '6'] }));
    const vacuum = mustId(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Vacuum', cadence: 'weekly', points: 20 }));
    mustId(await createChore(db, circleId, parent.id, { kidProfileId: kidId, title: 'Garage tidy', cadence: 'one_off', points: 50 }));
    const ctx = await kidCtx(circleId, kidId, parent.id);

    expect(await kidMarkChore(db, ctx, cat, FRI)).toBe('marked'); // pending on Friday
    expect(await kidMarkChore(db, ctx, dishes, FRI)).toBe('marked');
    const pending = (await listPendingCompletions(db, circleId, parent.id))!;
    const dishesPending = pending.find((p) => p.choreId === dishes)!;
    expect(await decideCompletion(db, circleId, parent.id, dishesPending.id, true, FRI)).toBe(true); // approved on Friday

    const chart = (await choreChart(db, circleId, parent.id, '2026-11-27', FRI))!;
    expect(chart.monday).toBe('2026-11-23');
    expect(chart.days).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
    expect(chart.today).toBe('2026-11-27');
    const row = chart.rows.find((r) => r.kidId === kidId)!;
    const cell = (i: number, title: string) => row.cells[i].find((e) => e.title === title);

    // Specific days: Friday pending, Saturday due, nothing on unscheduled days.
    expect(cell(4, 'Feed the cat')?.state).toBe('pending');
    expect(cell(5, 'Feed the cat')?.state).toBe('due');
    expect(cell(3, 'Feed the cat')).toBeUndefined();
    expect(cell(0, 'Feed the cat')).toBeUndefined();
    // Daily: every day, Friday approved, the rest due.
    for (let i = 0; i < 7; i++) expect(cell(i, 'Dishes')).toBeDefined();
    expect(cell(4, 'Dishes')?.state).toBe('approved');
    expect(cell(0, 'Dishes')?.state).toBe('due');
    // Weekly, not yet done: sits on today only. One-off, not done: nowhere.
    expect(cell(4, 'Vacuum')?.state).toBe('due');
    expect(cell(0, 'Vacuum')).toBeUndefined();
    expect(cell(5, 'Vacuum')).toBeUndefined();
    for (let i = 0; i < 7; i++) expect(cell(i, 'Garage tidy')).toBeUndefined();

    // Once the weekly chore is marked, it shows on its marked day as pending — and only there.
    expect(await kidMarkChore(db, ctx, vacuum, FRI)).toBe('marked');
    const chart2 = (await choreChart(db, circleId, parent.id, '2026-11-27', FRI))!;
    const row2 = chart2.rows.find((r) => r.kidId === kidId)!;
    expect(row2.cells[4].find((e) => e.title === 'Vacuum')?.state).toBe('pending');
    expect(row2.cells[5].find((e) => e.title === 'Vacuum')).toBeUndefined();

    // Last week: no completions existed, so dailies read due, the specific-days chore is on
    // its own days, and the weekly chore is absent (it is not "this week" any more).
    const last = (await choreChart(db, circleId, parent.id, '2026-11-20', FRI))!;
    expect(last.monday).toBe('2026-11-16');
    const lastRow = last.rows.find((r) => r.kidId === kidId)!;
    expect(lastRow.cells[4].find((e) => e.title === 'Feed the cat')?.state).toBe('due'); // Fri Nov 20
    expect(lastRow.cells[3].find((e) => e.title === 'Feed the cat')).toBeUndefined();
    expect(lastRow.cells.flat().some((e) => e.title === 'Vacuum')).toBe(false);

    const stranger = await adult();
    expect(await choreChart(db, circleId, stranger.id, '2026-11-27', FRI)).toBeNull();
  });
});
