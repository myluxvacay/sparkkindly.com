// @vitest-environment node
// Family Hub Phase 1 data layer: circles, invites, kid profiles, events and runs — every
// function scoped to the caller's own circles. A non-member must get exactly the answer
// "does not exist" for another circle's data, on reads and writes alike.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import {
  acceptInvite, claimRun, createCircle, createEvent, createInvite, createKid, deleteKid, doneRun,
  getCircle, listKids, listMembers, listOccurrences, listRuns, myCircles, releaseRun, updateKid,
} from '@/lib/family-hub/repo';
import { expandOccurrences, rideEligible, rideLinks, zonedDayRange, zonedLocalToUtc } from '@/lib/family-hub/rules';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-27T12:00:00Z');
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});

async function adult(): Promise<{ id: string; email: string }> {
  const email = `hub${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth: '1990-05-05' }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  return { id: r.accountId, email };
}

async function circleOf(owner: { id: string }): Promise<string> {
  const c = await createCircle(db, owner.id, 'The Test Family', 'America/New_York');
  if (typeof c !== 'object') throw new Error('circle failed');
  return c.id;
}

const mustId = (r: unknown): string => {
  if (typeof r !== 'object' || r === null || !('id' in r)) throw new Error('expected an id result');
  return (r as { id: string }).id;
};

const eventInput = (over: Record<string, unknown> = {}) => ({
  title: 'School pickup',
  startsAt: new Date('2026-11-27T20:00:00Z'),
  endsAt: new Date('2026-11-27T20:30:00Z'),
  recurrence: null,
  recurrenceUntil: null,
  location: 'Riverside Elementary',
  notes: null,
  isRun: true,
  driverUserId: null,
  memberIds: [],
  kidIds: [],
  ...over,
});

describe('circles and membership', () => {
  it('creator is organizer; a stranger sees nothing', async () => {
    const a = await adult();
    const b = await adult();
    const id = await circleOf(a);
    expect((await getCircle(db, id, a.id))?.role).toBe('organizer');
    expect(await getCircle(db, id, b.id)).toBeNull();
    expect(await myCircles(db, b.id)).toEqual([]);
    expect(await listMembers(db, id, b.id)).toBeNull();
    expect(await listKids(db, id, b.id)).toBeNull();
  });

  it('invite join flow: bound email only, single use, member afterwards', async () => {
    const a = await adult();
    const b = await adult();
    const c = await adult();
    const id = await circleOf(a);
    const inv = await createInvite(db, id, a.id, b.email, T0);
    expect(inv).not.toBeNull();
    // Wrong account cannot take an email-bound invite.
    expect((await acceptInvite(db, inv!.token, c.id, c.email, T0)).result).toBe('gone');
    expect((await acceptInvite(db, inv!.token, b.id, b.email, T0)).result).toBe('joined');
    expect((await getCircle(db, id, b.id))?.role).toBe('member');
    // Token is spent even for the rightful member.
    expect((await acceptInvite(db, inv!.token, b.id, b.email, T0)).result).toBe('gone');
    // A non-member cannot mint invites.
    expect(await createInvite(db, id, c.id, null, T0)).toBeNull();
  });
});

describe('kid profiles', () => {
  it('CRUD with Hub age groups incl. 13-17, avatar/colour defaults, optional phone', async () => {
    const a = await adult();
    const id = await circleOf(a);
    const teen = await createKid(db, id, a.id, { firstName: 'Teen A', ageGroup: '13-17', avatarId: 'rocket', colour: 'teal', phone: '+1 717-555-0100' });
    expect(typeof teen).toBe('object');
    const kid = await createKid(db, id, a.id, { firstName: 'Kid B', ageGroup: '6-8', avatarId: 'nope', colour: 'nope', phone: '' });
    expect(typeof kid).toBe('object');
    if (typeof kid !== 'object' || !kid) throw new Error('kid failed');
    expect(kid.avatarId).toBe('spark'); // unknown avatar falls back, never stored raw
    expect(kid.phone).toBeNull();
    expect(await createKid(db, id, a.id, { firstName: 'X', ageGroup: '10-12', avatarId: 'spark', colour: 'teal', phone: '' })).toBe('invalid');
    expect(await createKid(db, id, a.id, { firstName: 'X', ageGroup: '6-8', avatarId: 'spark', colour: 'teal', phone: 'abc' })).toBe('invalid');
    expect(await updateKid(db, id, a.id, kid.id, { firstName: 'Kid B', ageGroup: '9-12', avatarId: 'owl', colour: 'blue', phone: null })).toBe(true);
    expect((await listKids(db, id, a.id))?.map((k) => k.firstName)).toEqual(['Teen A', 'Kid B']);
    expect(await deleteKid(db, id, a.id, kid.id)).toBe(true);
  });

  it('a stranger cannot add, edit or delete kids in another circle', async () => {
    const a = await adult();
    const b = await adult();
    const id = await circleOf(a);
    expect(await createKid(db, id, b.id, { firstName: 'Nope', ageGroup: '6-8', avatarId: 'spark', colour: 'teal', phone: '' })).toBeNull();
    const kid = await createKid(db, id, a.id, { firstName: 'Real', ageGroup: '6-8', avatarId: 'spark', colour: 'teal', phone: '' });
    if (typeof kid !== 'object' || !kid) throw new Error('kid failed');
    expect(await updateKid(db, id, b.id, kid.id, { firstName: 'Hax', ageGroup: '6-8', avatarId: 'spark', colour: 'teal', phone: '' })).toBe(false);
    expect(await deleteKid(db, id, b.id, kid.id)).toBe(false);
  });
});

describe('events and runs', () => {
  it('run lifecycle: uncovered → claimed (covered) → released → claimed → done', async () => {
    const a = await adult();
    const b = await adult();
    const id = await circleOf(a);
    const inv = await createInvite(db, id, a.id, null, T0);
    await acceptInvite(db, inv!.token, b.id, b.email, T0);
    const ev = { id: mustId(await createEvent(db, id, a.id, eventInput())) };
    const from = new Date('2026-11-27T00:00:00Z');
    const to = new Date('2026-11-28T00:00:00Z');
    let runs = await listRuns(db, id, a.id, from, to);
    expect(runs?.[0]?.event.runStatus).toBe('uncovered');
    expect(await claimRun(db, id, b.id, ev.id)).toBe(true);
    runs = await listRuns(db, id, a.id, from, to);
    expect(runs?.[0]?.event.runStatus).toBe('covered');
    expect(runs?.[0]?.event.driverUserId).toBe(b.id);
    // A non-driver plain member cannot release someone else's run; the driver can.
    const c = await adult();
    const inv2 = await createInvite(db, id, a.id, c.email, T0);
    await acceptInvite(db, inv2!.token, c.id, c.email, T0);
    expect(await releaseRun(db, id, c.id, ev.id)).toBe(false);
    expect(await releaseRun(db, id, b.id, ev.id)).toBe(true);
    expect(await claimRun(db, id, a.id, ev.id)).toBe(true);
    expect(await doneRun(db, id, a.id, ev.id)).toBe(true);
    runs = await listRuns(db, id, a.id, from, to);
    expect(runs?.[0]?.event.runStatus).toBe('done');
  });

  it('cross-circle: a stranger cannot see or claim another circle\u2019s run', async () => {
    const a = await adult();
    const b = await adult();
    const id = await circleOf(a);
    const ev = { id: mustId(await createEvent(db, id, a.id, eventInput())) };
    const from = new Date('2026-11-27T00:00:00Z');
    const to = new Date('2026-11-28T00:00:00Z');
    expect(await listOccurrences(db, id, b.id, from, to)).toBeNull();
    expect(await listRuns(db, id, b.id, from, to)).toBeNull();
    expect(await claimRun(db, id, b.id, ev.id)).toBe(false);
    expect(await doneRun(db, id, b.id, ev.id)).toBe(false);
  });

  it('participants and driver must belong to the circle', async () => {
    const a = await adult();
    const outsider = await adult();
    const id = await circleOf(a);
    expect(await createEvent(db, id, a.id, eventInput({ driverUserId: outsider.id }))).toBe('invalid');
    expect(await createEvent(db, id, a.id, eventInput({ kidIds: ['123e4567-e89b-12d3-a456-426614174000'] }))).toBe('invalid');
  });

  it('weekly recurrence expands inside the window and stops at recurrence_until', async () => {
    const a = await adult();
    const id = await circleOf(a);
    mustId(await createEvent(db, id, a.id, eventInput({
      isRun: false,
      recurrence: 'weekly',
      recurrenceUntil: new Date('2026-12-11T00:00:00Z'),
    })));
    const occ = await listOccurrences(db, id, a.id, new Date('2026-11-27T00:00:00Z'), new Date('2026-12-31T00:00:00Z'));
    expect(occ?.length).toBe(3); // Nov 27, Dec 4, Dec 11
  });
});

describe('rules', () => {
  it('ride eligibility is 13-17 only', () => {
    expect(rideEligible('13-17')).toBe(true);
    for (const g of ['3-5', '6-8', '9-12', 'family', 'adult', '']) expect(rideEligible(g)).toBe(false);
  });

  it('ride links prefill the Uber drop-off; Lyft is a plain booking link', () => {
    const links = rideLinks('Riverside Elementary');
    expect(links.uber).toContain('dropoff%5Bformatted_address%5D=Riverside+Elementary');
    expect(links.lyft).toBe('https://ride.lyft.com/');
  });

  it('expandOccurrences: non-recurring inside/outside the window', () => {
    const e = { startsAt: new Date('2026-11-27T20:00:00Z'), recurrence: null, recurrenceUntil: null };
    expect(expandOccurrences(e, new Date('2026-11-27T00:00:00Z'), new Date('2026-11-28T00:00:00Z')).length).toBe(1);
    expect(expandOccurrences(e, new Date('2026-11-28T00:00:00Z'), new Date('2026-11-29T00:00:00Z')).length).toBe(0);
  });

  it('zoned time: 3:30pm in New York is 20:30 UTC in November; a NY day spans 05:00–05:00 UTC', () => {
    expect(zonedLocalToUtc('2026-11-27T15:30', 'America/New_York')?.toISOString()).toBe('2026-11-27T20:30:00.000Z');
    const { from, to } = zonedDayRange(new Date('2026-11-27T12:00:00Z'), 'America/New_York');
    expect(from.toISOString()).toBe('2026-11-27T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-28T05:00:00.000Z');
  });
});
