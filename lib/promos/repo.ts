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
  // Share/SEO overrides (migration 041): null falls back to title / short description / the hub share image.
  shareTitle: string | null;
  shareDescription: string | null;
  shareImage: string | null;
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
  share_title: string | null;
  share_description: string | null;
  share_image: string | null;
  config: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

const SELECT = `SELECT id, slug, type, title, short_description, body, rules, prize, status,
  starts_on::text AS starts_on, ends_on::text AS ends_on, share_title, share_description, share_image,
  config, created_at, updated_at FROM promotions`;

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
  shareTitle: r.share_title,
  shareDescription: r.share_description,
  shareImage: r.share_image,
  config: r.config ?? {},
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// The promotions hub's own share card (branded 1200x630 art in public/images/promos/), and the fallback
// share image for any promo whose record does not name one.
export const PROMO_HUB_SHARE_IMAGE = '/images/promos/share-hub.jpg';
export const PROMO_SHARE_WIDTH = 1200;
export const PROMO_SHARE_HEIGHT = 630;

// A promo is publicly visible while it is live and today falls inside its dates (an unset bound is open).
// Dates are calendar dates (UTC), the way the owner sets them in the admin form. `$n` is the parameter
// holding today's date.
const liveOn = (ph: string) =>
  `status = 'live' AND (starts_on IS NULL OR starts_on <= ${ph}::date) AND (ends_on IS NULL OR ends_on >= ${ph}::date)`;

export async function listLivePromos(q: Queryable, now: Date): Promise<Promo[]> {
  const r = await q.query<Row>(`${SELECT} WHERE ${liveOn('$1')} ORDER BY starts_on NULLS FIRST, title`, [dayOf(now)]);
  return r.rows.map(toPromo);
}

export async function getLivePromo(q: Queryable, slug: string, now: Date): Promise<Promo | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const r = await q.query<Row>(`${SELECT} WHERE slug = $1 AND ${liveOn('$2')}`, [slug, dayOf(now)]);
  return r.rows[0] ? toPromo(r.rows[0]) : null;
}

// Where a record stands today. Only `live` is playable and enterable; `ended` keeps a public page (a shared
// link must never land on a 404) but takes no entries; `draft` and `upcoming` are not public at all.
export type PromoPhase = 'draft' | 'upcoming' | 'live' | 'ended';

export function promoPhase(p: Promo, now: Date): PromoPhase {
  if (p.status === 'draft') return 'draft';
  if (p.status === 'ended') return 'ended';
  const today = dayOf(now);
  if (p.startsOn && today < p.startsOn) return 'upcoming';
  if (p.endsOn && today > p.endsOn) return 'ended';
  return 'live';
}

// The public read for a promo page: the record when it is live or ended, null when it should not be public.
export async function getPublicPromo(
  q: Queryable,
  slug: string,
  now: Date,
): Promise<{ promo: Promo; phase: 'live' | 'ended' } | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const r = await q.query<Row>(`${SELECT} WHERE slug = $1`, [slug]);
  if (!r.rows[0]) return null;
  const promo = toPromo(r.rows[0]);
  const phase = promoPhase(promo, now);
  return phase === 'live' || phase === 'ended' ? { promo, phase } : null;
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
  shareTitle?: string | null;
  shareDescription?: string | null;
  shareImage?: string | null;
  config: Record<string, unknown>;
};

export async function createPromo(q: Queryable, f: PromoFields): Promise<Promo> {
  const r = await q.query<Row>(
    `INSERT INTO promotions (slug, type, title, short_description, body, rules, prize, starts_on, ends_on,
       share_title, share_description, share_image, config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb) RETURNING *`,
    [
      f.slug, f.type, f.title, f.shortDescription, f.body, f.rules, f.prize, f.startsOn, f.endsOn,
      f.shareTitle ?? null, f.shareDescription ?? null, f.shareImage ?? null, JSON.stringify(f.config),
    ],
  );
  // RETURNING * loses the ::text date casts; re-read through SELECT for a consistent shape.
  return (await getPromoById(q, r.rows[0].id))!;
}

export async function updatePromo(q: Queryable, id: string, f: PromoFields): Promise<boolean> {
  const r = await q.query(
    `UPDATE promotions SET slug = $2, type = $3, title = $4, short_description = $5, body = $6, rules = $7,
       prize = $8, starts_on = $9, ends_on = $10, share_title = $11, share_description = $12, share_image = $13,
       config = $14::jsonb, updated_at = now() WHERE id = $1`,
    [
      id, f.slug, f.type, f.title, f.shortDescription, f.body, f.rules, f.prize, f.startsOn, f.endsOn,
      f.shareTitle ?? null, f.shareDescription ?? null, f.shareImage ?? null, JSON.stringify(f.config),
    ],
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

// One account's own entry, without the email: this is the read the public promo page makes, and an entrant's
// email is never needed there (listEntries below is the only email read, and it is admin-only).
export type EntryRef = { accountId: string; attestedAdult: boolean; enteredAt: Date };

export async function getEntry(q: Queryable, promotionId: string, accountId: string): Promise<EntryRef | null> {
  if (!isUuid(promotionId) || !isUuid(accountId)) return null;
  const r = await q.query<{ account_id: string; attested_adult: boolean; entered_at: Date }>(
    'SELECT account_id, attested_adult, entered_at FROM promo_entries WHERE promotion_id = $1 AND account_id = $2',
    [promotionId, accountId],
  );
  const row = r.rows[0];
  return row ? { accountId: row.account_id, attestedAdult: row.attested_adult, enteredAt: row.entered_at } : null;
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
