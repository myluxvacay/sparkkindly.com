// Promotion records and entries: plain SQL over the promotions / promo_entries tables (migration 040).
// A promotion is data — everything the public pages render and everything the mechanic needs comes from the
// row, so creating, editing, activating and ending a promotion never touches code or a deployment.
// Callers validate shapes (the admin actions validate form input; the entry route derives the account from
// the session). No Next.js imports. Verified by tests/unit/promos-repo.test.ts.
import type { Queryable } from '@/lib/db';
import { isUuid } from '@/lib/accounts/pin';
import { dayOf } from './streak';
import type { PromoStatus } from './types';

export type Promo = {
  id: string;
  slug: string;
  type: string;
  title: string;
  shortDescription: string;
  body: string;
  rules: string;
  prize: string;
  status: PromoStatus;
  startsOn: string | null;
  endsOn: string | null;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

type Row = {
  id: string;
  slug: string;
  type: string;
  title: string;
  short_description: string;
  body: string;
  rules: string;
  prize: string;
  status: PromoStatus;
  starts_on: string | null;
  ends_on: string | null;
  config: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

const SELECT = `SELECT id, slug, type, title, short_description, body, rules, prize, status,
  starts_on::text AS starts_on, ends_on::text AS ends_on, config, created_at, updated_at FROM promotions`;

const toPromo = (r: Row): Promo => ({
  id: r.id,
  slug: r.slug,
  type: r.type,
  title: r.title,
  shortDescription: r.short_description,
  body: r.body,
  rules: r.rules,
  prize: r.prize,
  status: r.status,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  config: r.config ?? {},
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// A promo is publicly visible while it is live and today falls inside its dates (an unset bound is open).
// Dates are site-days (UTC), the same convention as content scheduling.
const liveOn = (today: string) =>
  `status = 'live' AND (starts_on IS NULL OR starts_on <= '${today}'::date) AND (ends_on IS NULL OR ends_on >= '${today}'::date)`;

export async function listLivePromos(q: Queryable, now: Date): Promise<Promo[]> {
  const r = await q.query<Row>(`${SELECT} WHERE ${liveOn(dayOf(now))} ORDER BY starts_on NULLS FIRST, title`);
  return r.rows.map(toPromo);
}

export async function getLivePromo(q: Queryable, slug: string, now: Date): Promise<Promo | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const r = await q.query<Row>(`${SELECT} WHERE slug = $1 AND ${liveOn(dayOf(now))}`, [slug]);
  return r.rows[0] ? toPromo(r.rows[0]) : null;
}

export async function listPromosAdmin(q: Queryable): Promise<Promo[]> {
  const r = await q.query<Row>(`${SELECT} ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, title`);
  return r.rows.map(toPromo);
}

export async function getPromoById(q: Queryable, id: string): Promise<Promo | null> {
  if (!isUuid(id)) return null;
  const r = await q.query<Row>(`${SELECT} WHERE id = $1`, [id]);
  return r.rows[0] ? toPromo(r.rows[0]) : null;
}

export type PromoFields = {
  slug: string;
  type: string;
  title: string;
  shortDescription: string;
  body: string;
  rules: string;
  prize: string;
  startsOn: string | null;
  endsOn: string | null;
  config: Record<string, unknown>;
};

export async function createPromo(q: Queryable, f: PromoFields): Promise<Promo> {
  const r = await q.query<Row>(
    `INSERT INTO promotions (slug, type, title, short_description, body, rules, prize, starts_on, ends_on, config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING *`,
    [f.slug, f.type, f.title, f.shortDescription, f.body, f.rules, f.prize, f.startsOn, f.endsOn, JSON.stringify(f.config)],
  );
  // RETURNING * loses the ::text date casts; re-read through SELECT for a consistent shape.
  return (await getPromoById(q, r.rows[0].id))!;
}

export async function updatePromo(q: Queryable, id: string, f: PromoFields): Promise<boolean> {
  const r = await q.query(
    `UPDATE promotions SET slug = $2, type = $3, title = $4, short_description = $5, body = $6, rules = $7,
       prize = $8, starts_on = $9, ends_on = $10, config = $11::jsonb, updated_at = now() WHERE id = $1`,
    [id, f.slug, f.type, f.title, f.shortDescription, f.body, f.rules, f.prize, f.startsOn, f.endsOn, JSON.stringify(f.config)],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function setPromoStatus(q: Queryable, id: string, status: PromoStatus): Promise<boolean> {
  const r = await q.query('UPDATE promotions SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
  return (r.rowCount ?? 0) > 0;
}

// --- Entries ---------------------------------------------------------------

export type Entry = { accountId: string; email: string; attestedAdult: boolean; enteredAt: Date };

// True when the entry was newly recorded; false when the account had already entered.
export async function recordEntry(
  q: Queryable,
  promotionId: string,
  accountId: string,
  attestedAdult: boolean,
): Promise<boolean> {
  if (!isUuid(promotionId) || !isUuid(accountId)) return false;
  const r = await q.query(
    'INSERT INTO promo_entries (promotion_id, account_id, attested_adult) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [promotionId, accountId, attestedAdult],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function getEntry(q: Queryable, promotionId: string, accountId: string): Promise<Entry | null> {
  if (!isUuid(promotionId) || !isUuid(accountId)) return null;
  const r = await q.query<{ account_id: string; email: string; attested_adult: boolean; entered_at: Date }>(
    `SELECT e.account_id, a.email, e.attested_adult, e.entered_at FROM promo_entries e
     JOIN accounts a ON a.id = e.account_id WHERE e.promotion_id = $1 AND e.account_id = $2`,
    [promotionId, accountId],
  );
  const row = r.rows[0];
  return row ? { accountId: row.account_id, email: row.email, attestedAdult: row.attested_adult, enteredAt: row.entered_at } : null;
}

// Every entrant, oldest first. Admin only: this is the one place entrant emails are read, and it is only ever
// called behind requireAdmin — nothing public calls it.
export async function listEntries(q: Queryable, promotionId: string): Promise<Entry[]> {
  if (!isUuid(promotionId)) return [];
  const r = await q.query<{ account_id: string; email: string; attested_adult: boolean; entered_at: Date }>(
    `SELECT e.account_id, a.email, e.attested_adult, e.entered_at FROM promo_entries e
     JOIN accounts a ON a.id = e.account_id WHERE e.promotion_id = $1 ORDER BY e.entered_at, e.account_id`,
    [promotionId],
  );
  return r.rows.map((row) => ({
    accountId: row.account_id,
    email: row.email,
    attestedAdult: row.attested_adult,
    enteredAt: row.entered_at,
  }));
}
