import type { Queryable } from '@/lib/db';

// The admin publishing grid (/admin/publishing/): one row per item across days, newest first, filterable.
// A day counts as "reported" only when the reviewer agent's report landed (publishing_batches.report_received_at);
// its rows are then exactly what the jobs reported. Days without a report fall back to the items table: what was
// imported that day (created_at in America/New_York, the jobs' business timezone), minus anything already listed
// in a reported batch (a batch's import can land on a different day than its report). A digest-only batch row
// never suppresses a day's import history. All of that applies inside the selected window only.
//
// The window defaults to the last 7 days (America/New_York) so the page stays short; the range control asks for
// the last 30 days, everything, or a custom from/to span when older batches are wanted.

export type PublishingRow = {
  date: string; // YYYY-MM-DD
  world: string | null; // null only on a rejection recorded without one
  kind: string | null;
  title: string;
  slug: string | null; // published rows link by it; null means no live page to link
  status: 'published' | 'held';
  reason: string | null; // the reviewer's reason on held rows
};

export type PublishingDayMeta = {
  date: string;
  source: 'report' | 'import';
  digestPostUrl: string | null;
  digestExternalId: string | null;
  unlisted: number; // published items of the day past the per-day listing cap (bulk import days)
};

export type PublishingWindow = { from: string | null; to: string | null };

export type PublishingGridFilters = {
  world?: string;
  kind?: string;
  status?: string;
  q?: string;
  range?: string; // '7' (default) | '30' | 'all' | 'custom'
  from?: string; // custom range start, YYYY-MM-DD
  to?: string; // custom range end, YYYY-MM-DD
};

export type PublishingGrid = {
  rows: PublishingRow[]; // filtered, newest first, capped at MAX_ROWS
  total: number; // rows matching the filters before the cap
  publishedCount: number;
  heldCount: number;
  days: PublishingDayMeta[]; // the days present in `rows`, newest first
  range: string; // the effective range key
  window: PublishingWindow; // the effective window applied
};

// A daily batch is ~24 items. The grid caps the rendered rows; the counts stay exact so the admin can narrow
// the filters when a view is truncated.
const MAX_ROWS = 500;
// A fallback day can be a bulk import (the launch library was ~1,400 items in a day). At most this many of a
// day's published items are listed; the rest are reported in the day's `unlisted` count.
const MAX_LISTED_PER_DAY = 100;

const WORLDS = ['play', 'discover', 'together', 'grow', 'save', 'kids'];
const KINDS = ['article', 'activity', 'video', 'quiz'];
const STATUSES = ['published', 'held'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s?: string): s is string => {
  if (!s || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

export function resolvePublishingWindow(
  f: { range?: string; from?: string; to?: string },
  today: string = etToday(),
): { range: string; window: PublishingWindow } {
  switch (f.range) {
    case '30':
      return { range: '30', window: { from: shiftDate(today, -29), to: today } };
    case 'all':
      return { range: 'all', window: { from: null, to: null } };
    case 'custom': {
      let from = isDate(f.from) ? f.from : null;
      let to = isDate(f.to) ? f.to : null;
      if (from && to && from > to) [from, to] = [to, from];
      return { range: 'custom', window: { from, to } };
    }
    default:
      return { range: '7', window: { from: shiftDate(today, -6), to: today } };
  }
}

type BatchRow = { date: string; hasReport: boolean; digestPostUrl: string | null; digestExternalId: string | null };
type ItemRow = { date: string; world: string; kind: string; title: string; slug: string | null };
type RejectionRow = { date: string; title: string; world: string | null; kind: string | null; reason: string };
type DayRow = { date: string };

const byWorldThenTitle = (a: { world: string | null; title: string }, b: { world: string | null; title: string }) =>
  (a.world ?? '').localeCompare(b.world ?? '') || a.title.localeCompare(b.title);

export async function listPublishingGrid(db: Queryable, filters: PublishingGridFilters = {}): Promise<PublishingGrid> {
  const { range, window } = resolvePublishingWindow(filters);

  const batches = await db.query<BatchRow>(
    `SELECT batch_date::text AS date, report_received_at IS NOT NULL AS "hasReport",
            digest_post_url AS "digestPostUrl", digest_external_id AS "digestExternalId"
     FROM publishing_batches
     WHERE ($1::date IS NULL OR batch_date >= $1::date) AND ($2::date IS NULL OR batch_date <= $2::date)
     ORDER BY batch_date DESC`,
    [window.from, window.to],
  );
  const batchByDate = new Map(batches.rows.map((b) => [b.date, b]));
  const reportDates = batches.rows.filter((b) => b.hasReport).map((b) => b.date);

  const publishedByDate = new Map<string, ItemRow[]>();
  const rejectionsByDate = new Map<string, RejectionRow[]>();
  if (reportDates.length > 0) {
    const items = await db.query<ItemRow>(
      `SELECT batch_date::text AS date, world, kind, title, slug FROM publishing_items
       WHERE batch_date = ANY($1::date[])`,
      [reportDates],
    );
    for (const r of items.rows) publishedByDate.set(r.date, [...(publishedByDate.get(r.date) ?? []), r]);
    const rejections = await db.query<RejectionRow>(
      `SELECT batch_date::text AS date, title, world, kind, reason FROM publishing_rejections
       WHERE batch_date = ANY($1::date[])`,
      [reportDates],
    );
    for (const r of rejections.rows) rejectionsByDate.set(r.date, [...(rejectionsByDate.get(r.date) ?? []), r]);
  }

  // Fallback days: distinct import days in the window with published items and no reviewer report for that
  // date. Items that any reported batch already lists (same world + slug) are excluded, so a batch whose
  // import landed on a different day is not counted twice. Reported entries always carry a slug (for a quiz
  // it is the quiz id, which is also its items-table slug), so the exclusion covers quizzes as well; an entry
  // reported without a slug could still double-list, which is why the report contract asks for one.
  const fallbackDays = await db.query<DayRow>(
    `SELECT DISTINCT (i.created_at AT TIME ZONE 'America/New_York')::date::text AS date
     FROM items i
     WHERE i.status = 'published'
       AND (i.created_at AT TIME ZONE 'America/New_York')::date NOT IN (
         SELECT batch_date FROM publishing_batches WHERE report_received_at IS NOT NULL)
       AND ($1::date IS NULL OR (i.created_at AT TIME ZONE 'America/New_York')::date >= $1::date)
       AND ($2::date IS NULL OR (i.created_at AT TIME ZONE 'America/New_York')::date <= $2::date)
     ORDER BY date DESC LIMIT 366`,
    [window.from, window.to],
  );
  const fallbackDates = fallbackDays.rows.map((d) => d.date);
  if (fallbackDates.length > 0) {
    const items = await db.query<ItemRow>(
      `SELECT (i.created_at AT TIME ZONE 'America/New_York')::date::text AS date,
              w.slug AS world, i.kind, i.title, i.slug
       FROM items i JOIN worlds w ON w.id = i.world_id
       WHERE i.status = 'published'
         AND (i.created_at AT TIME ZONE 'America/New_York')::date = ANY($1::date[])
         AND NOT EXISTS (
           SELECT 1 FROM publishing_items pi WHERE pi.world = w.slug AND pi.slug = i.slug)`,
      [fallbackDates],
    );
    for (const r of items.rows) publishedByDate.set(r.date, [...(publishedByDate.get(r.date) ?? []), r]);
  }

  // Flatten to rows: days newest first; within a day the published rows (world, then title), then the held.
  const reportDateSet = new Set(reportDates);
  const allDates = [...new Set([...reportDates, ...fallbackDates])].sort().reverse();
  const unlistedByDate = new Map<string, number>();
  const sourceByDate = new Map<string, 'report' | 'import'>();
  const allRows: PublishingRow[] = [];
  for (const date of allDates) {
    const published = (publishedByDate.get(date) ?? []).sort(byWorldThenTitle);
    unlistedByDate.set(date, Math.max(0, published.length - MAX_LISTED_PER_DAY));
    sourceByDate.set(date, reportDateSet.has(date) ? 'report' : 'import');
    for (const p of published.slice(0, MAX_LISTED_PER_DAY)) {
      allRows.push({ date, world: p.world, kind: p.kind, title: p.title, slug: p.slug, status: 'published', reason: null });
    }
    const held = (rejectionsByDate.get(date) ?? []).sort(byWorldThenTitle);
    for (const r of held) {
      allRows.push({ date, world: r.world, kind: r.kind, title: r.title, slug: null, status: 'held', reason: r.reason });
    }
  }

  const world = filters.world && WORLDS.includes(filters.world) ? filters.world : null;
  const kind = filters.kind && KINDS.includes(filters.kind) ? filters.kind : null;
  const status = filters.status && STATUSES.includes(filters.status) ? filters.status : null;
  const q = filters.q?.trim().slice(0, 100).toLowerCase() || null;
  const filtered = allRows.filter(
    (r) =>
      (!world || r.world === world) &&
      (!kind || r.kind === kind) &&
      (!status || r.status === status) &&
      (!q || r.title.toLowerCase().includes(q)),
  );

  const rows = filtered.slice(0, MAX_ROWS);
  const days: PublishingDayMeta[] = [...new Set(rows.map((r) => r.date))].map((date) => ({
    date,
    source: sourceByDate.get(date) ?? 'import',
    digestPostUrl: batchByDate.get(date)?.digestPostUrl ?? null,
    digestExternalId: batchByDate.get(date)?.digestExternalId ?? null,
    unlisted: unlistedByDate.get(date) ?? 0,
  }));
  return {
    rows,
    total: filtered.length,
    publishedCount: filtered.filter((r) => r.status === 'published').length,
    heldCount: filtered.filter((r) => r.status === 'held').length,
    days,
    range,
    window,
  };
}
