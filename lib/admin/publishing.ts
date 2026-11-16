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
  unlisted: number; // published items matching the filters that the listing caps left out (bulk import days)
  rowCount: number; // rows of this day in the grid (0 for a reported day with nothing in the current view)
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

// A daily batch is ~24 items. The grid caps the rendered rows (per day and overall); filtering and the counts
// run over the full set first, so a title search reaches every item and the totals stay exact — the caps only
// bound what is rendered, and the difference is reported per day as `unlisted`.
const MAX_ROWS = 500;
// A fallback day can be a bulk import (the launch library was ~1,400 items in a day). At most this many of a
// day's published items are rendered.
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
      // A provided but unparseable date falls back to the default window (after the switch) rather than
      // silently widening the view to everything; an absent side is simply unbounded on that side.
      if (!f.from || isDate(f.from)) {
        if (!f.to || isDate(f.to)) {
          let from = isDate(f.from) ? f.from : null;
          let to = isDate(f.to) ? f.to : null;
          if (from && to && from > to) [from, to] = [to, from];
          return { range: 'custom', window: { from, to } };
        }
      }
      break;
    }
    default:
      break;
  }
  return { range: '7', window: { from: shiftDate(today, -6), to: today } };
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
     ORDER BY date DESC`,
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
  const sourceByDate = new Map<string, 'report' | 'import'>();
  const allRows: PublishingRow[] = [];
  for (const date of allDates) {
    sourceByDate.set(date, reportDateSet.has(date) ? 'report' : 'import');
    const published = (publishedByDate.get(date) ?? []).sort(byWorldThenTitle);
    for (const p of published) {
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

  // Render caps, applied after filtering: at most MAX_LISTED_PER_DAY published rows of a day, then MAX_ROWS
  // overall. What the caps leave out is counted per day as `unlisted`, so the totals above stay exact.
  const displayedPublishedByDate = new Map<string, number>();
  const capped: PublishingRow[] = [];
  for (const r of filtered) {
    if (r.status === 'published') {
      const n = displayedPublishedByDate.get(r.date) ?? 0;
      if (n >= MAX_LISTED_PER_DAY) continue;
      displayedPublishedByDate.set(r.date, n + 1);
    }
    capped.push(r);
  }
  const rows = capped.slice(0, MAX_ROWS);
  const shownPublishedByDate = new Map<string, number>();
  const shownRowsByDate = new Map<string, number>();
  for (const r of rows) {
    shownRowsByDate.set(r.date, (shownRowsByDate.get(r.date) ?? 0) + 1);
    if (r.status === 'published') shownPublishedByDate.set(r.date, (shownPublishedByDate.get(r.date) ?? 0) + 1);
  }
  const filteredPublishedByDate = new Map<string, number>();
  for (const r of filtered) {
    if (r.status === 'published') filteredPublishedByDate.set(r.date, (filteredPublishedByDate.get(r.date) ?? 0) + 1);
  }

  // Day context is per day, not per row: every reported day in the window and every day with a recorded
  // digest keeps its meta (and so its digest line) even when the current filters show none of its rows —
  // a reported day with no items at all still leaves a trace — alongside the days the rows cover.
  const digestDates = batches.rows.filter((b) => b.digestPostUrl || b.digestExternalId).map((b) => b.date);
  const metaDates = [...new Set([...reportDates, ...digestDates, ...rows.map((r) => r.date)])].sort().reverse();
  const days: PublishingDayMeta[] = metaDates.map((date) => ({
    date,
    source: sourceByDate.get(date) ?? 'import',
    digestPostUrl: batchByDate.get(date)?.digestPostUrl ?? null,
    digestExternalId: batchByDate.get(date)?.digestExternalId ?? null,
    unlisted: Math.max(0, (filteredPublishedByDate.get(date) ?? 0) - (shownPublishedByDate.get(date) ?? 0)),
    rowCount: shownRowsByDate.get(date) ?? 0,
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
