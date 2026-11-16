import type { Queryable } from '@/lib/db';

// The admin publishing summary (/admin/publishing/): one entry per day, newest first.
// A day counts as "reported" only when the reviewer agent's report landed (publishing_batches.report_received_at);
// its items and rejections are then exactly what the jobs reported, and a digest post recorded for the day — by
// either kind of day — is shown alongside. Days without a report fall back to the items table: what was imported
// that day (created_at in America/New_York, the jobs' business timezone), minus anything already listed in a
// reported batch (a batch's import can land on a different day than its report). A digest-only batch row never
// suppresses a day's import history.

export type PublishedEntry = { world: string; kind: string; title: string; slug: string | null };
export type RejectionEntry = { title: string; world: string | null; kind: string | null; reason: string };

export type PublishingDay = {
  date: string; // YYYY-MM-DD
  source: 'report' | 'import';
  published: PublishedEntry[]; // capped at MAX_LISTED; publishedTotal is the full count
  publishedTotal: number;
  rejections: RejectionEntry[];
  digestPostUrl: string | null;
  digestExternalId: string | null;
};

// A daily batch is ~24 items, but a fallback day can be a bulk import (the launch library was ~1,400 items in
// a day). The page lists at most this many and reports the rest as a count.
const MAX_LISTED = 100;

type BatchRow = { date: string; hasReport: boolean; digestPostUrl: string | null; digestExternalId: string | null };
type ItemRow = PublishedEntry & { date: string };
type RejectionRow = RejectionEntry & { date: string };
type DayRow = { date: string };

const byWorldThenTitle = (a: PublishedEntry, b: PublishedEntry) =>
  a.world.localeCompare(b.world) || a.title.localeCompare(b.title);

export async function listPublishingDays(db: Queryable, limit = 30): Promise<PublishingDay[]> {
  const batches = await db.query<BatchRow>(
    `SELECT batch_date::text AS date, report_received_at IS NOT NULL AS "hasReport",
            digest_post_url AS "digestPostUrl", digest_external_id AS "digestExternalId"
     FROM publishing_batches ORDER BY batch_date DESC LIMIT $1`,
    [Math.max(limit * 2, 60)],
  );
  const batchByDate = new Map(batches.rows.map((b) => [b.date, b]));
  const reportDates = batches.rows.filter((b) => b.hasReport).map((b) => b.date).slice(0, limit);

  const itemsByDate = new Map<string, PublishedEntry[]>();
  const rejectionsByDate = new Map<string, RejectionEntry[]>();
  if (reportDates.length > 0) {
    const items = await db.query<ItemRow>(
      `SELECT batch_date::text AS date, world, kind, title, slug FROM publishing_items
       WHERE batch_date = ANY($1::date[])`,
      [reportDates],
    );
    for (const r of items.rows) {
      const { date, ...entry } = r;
      itemsByDate.set(date, [...(itemsByDate.get(date) ?? []), entry]);
    }
    const rejections = await db.query<RejectionRow>(
      `SELECT batch_date::text AS date, title, world, kind, reason FROM publishing_rejections
       WHERE batch_date = ANY($1::date[])`,
      [reportDates],
    );
    for (const r of rejections.rows) {
      const { date, ...entry } = r;
      rejectionsByDate.set(date, [...(rejectionsByDate.get(date) ?? []), entry]);
    }
  }

  // Fallback days: distinct import days with published items and no reviewer report for that date. Items that
  // any reported batch already lists (same world + slug) are excluded, so a batch whose import landed on a
  // different day is not counted twice. Reported entries always carry a slug (for a quiz it is the quiz id,
  // which is also its items-table slug), so the exclusion covers quizzes as well; an entry reported without a
  // slug could still double-list, which is why the report contract asks for one.
  const fallbackDays = await db.query<DayRow>(
    `SELECT DISTINCT (i.created_at AT TIME ZONE 'America/New_York')::date::text AS date
     FROM items i
     WHERE i.status = 'published'
       AND (i.created_at AT TIME ZONE 'America/New_York')::date NOT IN (
         SELECT batch_date FROM publishing_batches WHERE report_received_at IS NOT NULL)
     ORDER BY date DESC LIMIT $1`,
    [limit],
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
    for (const r of items.rows) {
      const { date, ...entry } = r;
      itemsByDate.set(date, [...(itemsByDate.get(date) ?? []), entry]);
    }
  }

  const listed = (date: string) => (itemsByDate.get(date) ?? []).sort(byWorldThenTitle).slice(0, MAX_LISTED);
  const days: PublishingDay[] = [
    ...reportDates.map((date) => ({
      date,
      source: 'report' as const,
      published: listed(date),
      publishedTotal: (itemsByDate.get(date) ?? []).length,
      rejections: rejectionsByDate.get(date) ?? [],
      digestPostUrl: batchByDate.get(date)?.digestPostUrl ?? null,
      digestExternalId: batchByDate.get(date)?.digestExternalId ?? null,
    })),
    ...fallbackDates
      // A fallback date whose items were all claimed by reported batches has nothing of its own to show.
      .filter((date) => (itemsByDate.get(date) ?? []).length > 0)
      .map((date) => ({
        date,
        source: 'import' as const,
        published: listed(date),
        publishedTotal: (itemsByDate.get(date) ?? []).length,
        rejections: [],
        digestPostUrl: batchByDate.get(date)?.digestPostUrl ?? null,
        digestExternalId: batchByDate.get(date)?.digestExternalId ?? null,
      })),
  ];
  days.sort((a, b) => b.date.localeCompare(a.date));
  return days.slice(0, limit);
}
