import type { Queryable } from '@/lib/db';

// The admin publishing summary (/admin/publishing/): one entry per day, newest first.
// Days with a publishing report (written by the reviewer and promoter agents through /api/agent/publishing/*)
// show exactly what those jobs reported. Days before reports existed fall back to the items table: what was
// imported that day (created_at in America/New_York, the jobs' business timezone), with no rejections or
// digest post, because neither was recorded anywhere the site can read.

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

type BatchRow = { date: string; digestPostUrl: string | null; digestExternalId: string | null };
type ItemRow = PublishedEntry & { date: string };
type RejectionRow = RejectionEntry & { date: string };
type DayRow = { date: string };

const byWorldThenTitle = (a: PublishedEntry, b: PublishedEntry) =>
  a.world.localeCompare(b.world) || a.title.localeCompare(b.title);

export async function listPublishingDays(db: Queryable, limit = 30): Promise<PublishingDay[]> {
  const batches = await db.query<BatchRow>(
    `SELECT batch_date::text AS date, digest_post_url AS "digestPostUrl", digest_external_id AS "digestExternalId"
     FROM publishing_batches ORDER BY batch_date DESC LIMIT $1`,
    [limit],
  );
  const reportDates = batches.rows.map((b) => b.date);

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

  // Fallback days: distinct import days with published items and no report for that date. Heuristic: if a
  // reported batch's import landed on a later day, that later day can also appear here with the same items;
  // for the pre-report history this fallback exists for, import day and batch day are the same day.
  const fallbackDays = await db.query<DayRow>(
    `SELECT DISTINCT (created_at AT TIME ZONE 'America/New_York')::date::text AS date
     FROM items
     WHERE status = 'published'
       AND (created_at AT TIME ZONE 'America/New_York')::date NOT IN (SELECT batch_date FROM publishing_batches)
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
         AND (i.created_at AT TIME ZONE 'America/New_York')::date = ANY($1::date[])`,
      [fallbackDates],
    );
    for (const r of items.rows) {
      const { date, ...entry } = r;
      itemsByDate.set(date, [...(itemsByDate.get(date) ?? []), entry]);
    }
  }

  const listed = (date: string) => (itemsByDate.get(date) ?? []).sort(byWorldThenTitle).slice(0, MAX_LISTED);
  const days: PublishingDay[] = [
    ...batches.rows.map((b) => ({
      date: b.date,
      source: 'report' as const,
      published: listed(b.date),
      publishedTotal: (itemsByDate.get(b.date) ?? []).length,
      rejections: rejectionsByDate.get(b.date) ?? [],
      digestPostUrl: b.digestPostUrl,
      digestExternalId: b.digestExternalId,
    })),
    ...fallbackDates.map((date) => ({
      date,
      source: 'import' as const,
      published: listed(date),
      publishedTotal: (itemsByDate.get(date) ?? []).length,
      rejections: [],
      digestPostUrl: null,
      digestExternalId: null,
    })),
  ];
  days.sort((a, b) => b.date.localeCompare(a.date));
  return days.slice(0, limit);
}
