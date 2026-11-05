// The owner's sponsorship changes and the /admin/sponsors/ list (plan 6). lib/admin/actions.ts wraps these in audited
// actions (sponsor.create, sponsorship.attach, sponsorship.end); each returns an outcome, never throws for bad input.
// A sponsor is saved only in an allowed category with the confirmation box ticked (recorded as confirmed_at). A
// sponsorship attaches to an existing published adults item outside Kids (named by its "world/slug" path), an existing
// topic, or a world other than Kids. Clicks are never written here. No Next.js imports.
// Verified by tests/unit/sponsorship-web.test.tsx.
import type { Queryable } from '@/lib/db';
import { itemMayCarrySponsorship } from './eligibility';
import { validateSponsor, validateSponsorship, type SponsorInput, type SponsorshipInput } from './rules';

type Fail = { ok: false; reason: 'rules' | 'invalid' | 'target' | 'missing' };
type Outcome<T> = { ok: true; value: T } | Fail;
const fail = (reason: Fail['reason']): Fail => ({ ok: false, reason });

const formObject = (f: URLSearchParams) => Object.fromEntries([...f.keys()].map((k) => [k, f.get(k)]));

export async function createSponsor(tx: Queryable, form: URLSearchParams, now: Date): Promise<Outcome<SponsorInput & { id: number }>> {
  const v = validateSponsor({ ...formObject(form), confirmed: form.get('confirmed') === 'on' });
  if (!v.ok) {
    return fail('rules');
  }
  const r = await tx.query<{ id: number }>(
    'INSERT INTO sponsors (name, link, category, confirmed_at) VALUES ($1, $2, $3, $4) RETURNING id',
    [v.value.name, v.value.link, v.value.category, now],
  );
  return { ok: true, value: { ...v.value, id: r.rows[0].id } };
}

const ITEM_PATH = /^\/?([a-z0-9-]{2,30})\/([a-z0-9-]{1,80})\/?$/;

// The target's id column and value, or null when the target may not carry sponsorship.
async function resolveTarget(tx: Queryable, s: SponsorshipInput): Promise<{ column: string; id: string | number } | null> {
  if (s.target === 'topic') {
    const r = await tx.query<{ id: number }>('SELECT id FROM topics WHERE slug = $1', [s.targetRef]);
    return r.rows[0] ? { column: 'topic_id', id: r.rows[0].id } : null;
  }
  if (s.target === 'world') {
    const r = await tx.query<{ id: number }>("SELECT id FROM worlds WHERE slug = $1 AND slug <> 'kids'", [s.targetRef]);
    return r.rows[0] ? { column: 'world_id', id: r.rows[0].id } : null;
  }
  const m = ITEM_PATH.exec(s.targetRef);
  if (!m) {
    return null;
  }
  const r = await tx.query<{ id: string; audience: string; status: string; risk_tier: string }>(
    `SELECT i.id, i.audience, i.status, i.risk_tier FROM items i JOIN worlds w ON w.id = i.world_id
     WHERE w.slug = $1 AND i.slug = $2 AND i.locale = 'en'`,
    [m[1], m[2]],
  );
  const row = r.rows[0];
  const ok = row && itemMayCarrySponsorship({ ...row, worldSlug: m[1], riskTier: row.risk_tier });
  return ok ? { column: 'item_id', id: row.id } : null;
}

export async function attachSponsorship(tx: Queryable, form: URLSearchParams): Promise<Outcome<SponsorshipInput & { id: number }>> {
  const v = validateSponsorship({
    sponsorId: form.get('sponsor'),
    target: form.get('target'),
    targetRef: form.get('ref'),
    label: form.get('label'),
    kind: form.get('kind'),
    startsOn: form.get('starts_on'),
    endsOn: form.get('ends_on'),
  });
  if (!v.ok) {
    return fail('invalid');
  }
  const sponsor = await tx.query('SELECT 1 FROM sponsors WHERE id = $1 AND confirmed_at IS NOT NULL', [v.value.sponsorId]);
  if (!sponsor.rows.length) {
    return fail('missing');
  }
  const target = await resolveTarget(tx, v.value);
  if (!target) {
    return fail('target');
  }
  const r = await tx.query<{ id: number }>(
    `INSERT INTO sponsorships (sponsor_id, ${target.column}, label, kind, starts_on, ends_on)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [v.value.sponsorId, target.id, v.value.label, v.value.kind, v.value.startsOn, v.value.endsOn],
  );
  return { ok: true, value: { ...v.value, id: r.rows[0].id } };
}

// Ends a sponsorship now; false when there is no such sponsorship or it has already ended.
export async function endSponsorship(tx: Queryable, id: number, now: Date): Promise<boolean> {
  const r = await tx.query('UPDATE sponsorships SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL', [id, now]);
  return r.rowCount === 1;
}

export type AdminSponsor = { id: number; name: string; link: string; category: string | null; confirmed: boolean };
export type AdminSponsorship = {
  id: number;
  sponsor: string;
  target: string;
  label: string;
  kind: string;
  startsOn: string | null;
  endsOn: string | null;
  ended: boolean;
  clicks: number;
};

const LIST_LIMIT = 200;

export async function listSponsorsAdmin(db: Queryable): Promise<{ sponsors: AdminSponsor[]; sponsorships: AdminSponsorship[] }> {
  const sponsors = await db.query<AdminSponsor>(
    `SELECT id, name, link, category, confirmed_at IS NOT NULL AS confirmed FROM sponsors ORDER BY id DESC LIMIT ${LIST_LIMIT}`,
  );
  const ships = await db.query<AdminSponsorship>(
    `SELECT s.id, sp.name AS sponsor, s.label, s.kind, s.click_count AS clicks, s.ended_at IS NOT NULL AS ended,
            to_char(s.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(s.ends_on, 'YYYY-MM-DD') AS "endsOn",
            CASE WHEN s.item_id IS NOT NULL THEN 'item ' || w.slug || '/' || i.slug
                 WHEN s.topic_id IS NOT NULL THEN 'topic ' || t.slug ELSE 'world ' || sw.slug END AS target
     FROM sponsorships s JOIN sponsors sp ON sp.id = s.sponsor_id
     LEFT JOIN items i ON i.id = s.item_id LEFT JOIN worlds w ON w.id = i.world_id
     LEFT JOIN topics t ON t.id = s.topic_id LEFT JOIN worlds sw ON sw.id = s.world_id
     ORDER BY s.id DESC LIMIT ${LIST_LIMIT}`,
  );
  return { sponsors: sponsors.rows, sponsorships: ships.rows };
}
