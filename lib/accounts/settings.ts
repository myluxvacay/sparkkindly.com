// Account settings: the time zone and three notification preferences (all off by default). A save is validated whole
// before anything is written: an invalid time zone, a non-boolean preference or an unknown key changes nothing.
// The account id comes from the server-side context. No Next.js imports; tests/unit/account-settings.test.ts.
import type { Db } from '@/lib/db';
import { isUuid } from './pin';

export type Notify = { dailySet: boolean; weeklyCircle: boolean; invites: boolean };
export type Settings = { timeZone: string; notify: Notify };

// Preference key -> column. Also the allow-list: any other key is refused.
export const NOTIFY_COLUMNS: Record<keyof Notify, string> = {
  dailySet: 'notify_daily_set',
  weeklyCircle: 'notify_weekly_circle',
  invites: 'notify_invites',
};

const ZONES = new Set<string>([...Intl.supportedValuesOf('timeZone'), 'UTC']);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export async function getSettings(db: Db, accountId: string): Promise<Settings | null> {
  if (!isUuid(accountId)) {
    return null;
  }
  const r = await db.query<{ time_zone: string; d: boolean; w: boolean; i: boolean }>(
    `SELECT time_zone, notify_daily_set AS d, notify_weekly_circle AS w, notify_invites AS i
     FROM accounts WHERE id = $1`,
    [accountId],
  );
  const row = r.rows[0];
  return row ? { timeZone: row.time_zone, notify: { dailySet: row.d, weeklyCircle: row.w, invites: row.i } } : null;
}

// The column updates a valid input asks for, or null when anything in it is invalid.
function changes(input: Record<string, unknown>): [string, string | boolean][] | null {
  if (Object.keys(input).some((k) => k !== 'timeZone' && k !== 'notify')) {
    return null;
  }
  const out: [string, string | boolean][] = [];
  if (input.timeZone !== undefined) {
    if (typeof input.timeZone !== 'string' || !ZONES.has(input.timeZone)) {
      return null;
    }
    out.push(['time_zone', input.timeZone]);
  }
  if (input.notify !== undefined) {
    if (!isPlainObject(input.notify)) {
      return null;
    }
    for (const [key, value] of Object.entries(input.notify)) {
      const column = Object.hasOwn(NOTIFY_COLUMNS, key) ? NOTIFY_COLUMNS[key as keyof Notify] : null;
      if (!column || typeof value !== 'boolean') {
        return null;
      }
      out.push([column, value]);
    }
  }
  return out;
}

export async function saveSettings(
  db: Db,
  accountId: string,
  input: { timeZone?: unknown; notify?: unknown },
): Promise<'ok' | 'invalid'> {
  const set = isPlainObject(input) && isUuid(accountId) ? changes(input) : null;
  if (!set) {
    return 'invalid';
  }
  // Column names come from the fixed allow-list above; values are parameters.
  const assignments = set.map(([column], i) => `${column} = $${i + 2}`);
  const sql = assignments.length
    ? `UPDATE accounts SET ${assignments.join(', ')} WHERE id = $1`
    : 'SELECT 1 FROM accounts WHERE id = $1';
  const r = await db.query(sql, [accountId, ...set.map(([, value]) => value)]);
  return (assignments.length ? (r.rowCount ?? 0) : r.rows.length) > 0 ? 'ok' : 'invalid';
}
