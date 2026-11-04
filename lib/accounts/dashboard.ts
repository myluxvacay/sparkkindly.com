// The /me dashboard (plan 3D, Task 4): today's and recent items matching the profile's interests, what the profile has
// answered and a plain count. Every item comes through the scoped public reads with the context's audiences, so a
// child context never gets an `adults` item, in any list or in answered history. "Today" is the account's local calendar
// day (accounts.time_zone, UTC when unknown). The owner is the server-side context, never a request field.
// No Next.js imports. Verified by tests/unit/account-dashboard.test.ts.
import type { Db } from '@/lib/db';
import type { PublicItem } from '@/lib/items/repo';
import { listByInterests, listPublicByIds } from '@/lib/public/reads';
import type { Scope } from '@/lib/public/scope';
import type { AccountContext } from './context';
import { getInterests, type Owner } from './interests';
import { countAnswered, listAnswered } from './responses';

const RECENT_DAYS = 14;
const MAX_ITEMS = 20;

export type Dashboard = {
  today: PublicItem[];
  recent: PublicItem[];
  answered: { item: PublicItem; correct: boolean; answeredAt: Date }[];
  progress: { total: number; correct: number };
  hasInterests: boolean;
};

// The zone's wall-clock fields at an instant.
function wallClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute'), s: get('second') };
}

// How far the zone's wall clock is ahead of UTC at an instant, in milliseconds.
function offsetAt(at: Date, timeZone: string): number {
  const w = wallClock(at, timeZone);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(at.getTime() / 1000) * 1000;
}

// The instant the local day `days` away from now's local day starts in the zone (unknown zone: UTC). DST-safe: the
// offset is taken again at the first guess, so a day after a clock change starts at its own local midnight.
export function localDayStart(now: Date, timeZone: string, days: number): Date {
  let zone = timeZone;
  try {
    wallClock(now, zone);
  } catch {
    zone = 'UTC';
  }
  const w = wallClock(now, zone);
  const midnightAsUtc = Date.UTC(w.y, w.m - 1, w.d + days);
  const first = midnightAsUtc - offsetAt(new Date(midnightAsUtc), zone);
  const second = midnightAsUtc - offsetAt(new Date(first), zone);
  // Normally `second` is the answer. When local midnight falls in a clock gap (America/Santiago in September), one
  // candidate lands in the previous local day and the other is the gap's end, which is where the day starts.
  const onDay = (t: number) => {
    const x = wallClock(new Date(t), zone);
    return Date.UTC(x.y, x.m - 1, x.d) === midnightAsUtc;
  };
  const candidates = [first, second].filter(onDay).sort((a, b) => a - b);
  return new Date(candidates[0] ?? second);
}

async function timeZoneOf(db: Db, accountId: string): Promise<string> {
  const r = await db.query<{ time_zone: string }>('SELECT time_zone FROM accounts WHERE id = $1', [accountId]);
  return r.rows[0]?.time_zone ?? 'UTC';
}

async function answeredItems(db: Db, owner: Owner, scope: Scope): Promise<Dashboard['answered']> {
  const rows = await listAnswered(db, owner, scope, { limit: MAX_ITEMS, offset: 0 });
  const visible = new Map((await listPublicByIds(db, scope, rows.map((r) => r.itemId))).map((i) => [i.id, i]));
  return rows.flatMap((r) => {
    const item = visible.get(r.itemId);
    return item ? [{ item, correct: r.correct, answeredAt: r.answeredAt }] : [];
  });
}

export async function dashboardFor(db: Db, ctx: AccountContext, now: Date): Promise<Dashboard> {
  const owner: Owner = { accountId: ctx.account.id, profileId: ctx.profile?.id ?? null };
  const scope: Scope = { audiences: ctx.audiences, now };
  const [interests, zone, answered, progress] = await Promise.all([
    getInterests(db, owner),
    timeZoneOf(db, owner.accountId),
    answeredItems(db, owner, scope),
    countAnswered(db, owner, scope),
  ]);
  const picks = { ...interests, limit: MAX_ITEMS };
  const start = localDayStart(now, zone, 0);
  const [today, recent] = await Promise.all([
    listByInterests(db, scope, { ...picks, from: start, to: localDayStart(now, zone, 1) }),
    listByInterests(db, scope, { ...picks, from: localDayStart(now, zone, -RECENT_DAYS), to: start }),
  ]);
  return { today, recent, answered, progress, hasInterests: interests.topicIds.length + interests.worldIds.length > 0 };
}
