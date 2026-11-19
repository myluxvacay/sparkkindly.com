// The promotion admin actions, merged into lib/admin/actions.ts, which runs each inside one transaction with
// its audit_log row and makes them unknown while promotions are switched off. Creating, editing, activating
// and ending a promotion are all data edits here — none of them needs a deployment. `fail` builds that
// module's action error, so a refusal reaches the owner as a fixed message code. No Next.js imports.
// Verified by tests/unit/promos-repo.test.ts.
import type { Queryable } from '@/lib/db';
import type { ErrorCode } from '@/lib/admin/messages';
import { RESERVED_WORLD_SLUGS } from '@/lib/public/scope';
import { createPromo, getPromoById, setPromoStatus, updatePromo, type PromoFields } from './repo';
import { monthEnded, runDraw } from './draw';
import { isPromoType, type PromoStatus } from './types';

type Ctx = { tx: Queryable; admin: { email: string }; form: URLSearchParams; now: Date };
type Done = {
  code: 'promo_created' | 'promo_saved' | 'promo_status' | 'promo_drawn';
  target: string;
  detail?: Record<string, unknown>;
};
type Fail = (status: 400 | 404 | 409, code: ErrorCode) => Error;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{3,80}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const field = (f: URLSearchParams, name: string) => (f.get(name) ?? '').trim();

function text(f: URLSearchParams, name: string, max: number, min = 0, fail: Fail): string {
  const v = field(f, name);
  if (v.length < min || v.length > max) throw fail(400, 'bad_input');
  return v;
}

function dateField(f: URLSearchParams, name: string, fail: Fail): string | null {
  const v = field(f, name);
  if (v === '') return null;
  if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw fail(400, 'bad_input');
  return v;
}

function intField(f: URLSearchParams, name: string, fallback: number, min: number, max: number, fail: Fail): number {
  const v = field(f, name);
  if (v === '') return fallback;
  if (!/^\d{1,3}$/.test(v)) throw fail(400, 'bad_input');
  const n = Number(v);
  if (n < min || n > max) throw fail(400, 'bad_input');
  return n;
}

function promoId(f: URLSearchParams, fail: Fail): string {
  const id = field(f, 'id');
  if (!UUID.test(id)) throw fail(404, 'not_found');
  return id;
}

// The record's fields from the admin form. The streak settings ride in the config jsonb; another type keeps
// whatever config it already had (on create, none), so editing a future type's text never drops its settings.
function fieldsFrom(form: URLSearchParams, fail: Fail, existingConfig: Record<string, unknown>): PromoFields {
  const slug = field(form, 'slug');
  if (!SLUG.test(slug) || RESERVED_WORLD_SLUGS.includes(slug)) throw fail(400, 'bad_input');
  const type = field(form, 'type');
  if (!isPromoType(type)) throw fail(400, 'bad_input');
  const startsOn = dateField(form, 'starts_on', fail);
  const endsOn = dateField(form, 'ends_on', fail);
  if (startsOn && endsOn && endsOn < startsOn) throw fail(400, 'bad_input');
  const config =
    type === 'streak_draw'
      ? {
          targetDays: intField(form, 'target_days', 10, 2, 60, fail),
          freezeAllowance: intField(form, 'freeze_allowance', 1, 0, 7, fail),
          winnersPerDraw: intField(form, 'winners_per_draw', 5, 1, 50, fail),
        }
      : existingConfig;
  return {
    slug,
    type,
    title: text(form, 'title', 120, 1, fail),
    shortDescription: text(form, 'short_description', 300, 1, fail),
    body: text(form, 'body', 8000, 0, fail),
    rules: text(form, 'rules', 12000, 0, fail),
    prize: text(form, 'prize', 300, 0, fail),
    startsOn,
    endsOn,
    config,
  };
}

export function promoHandlers(fail: Fail): Record<string, (c: Ctx) => Promise<Done>> {
  return {
    async 'promo.create'({ tx, form }) {
      const f = fieldsFrom(form, fail, {});
      const promo = await createPromo(tx, f);
      return { code: 'promo_created', target: `promo:${promo.slug}`, detail: { type: f.type } };
    },

    async 'promo.update'({ tx, form }) {
      const id = promoId(form, fail);
      const existing = await getPromoById(tx, id);
      if (!existing) throw fail(404, 'not_found');
      const f = fieldsFrom(form, fail, existing.config);
      if (!(await updatePromo(tx, id, f))) throw fail(404, 'not_found');
      return { code: 'promo_saved', target: `promo:${f.slug}` };
    },

    async 'promo.status'({ tx, form }) {
      const id = promoId(form, fail);
      const status = field(form, 'status');
      if (status !== 'draft' && status !== 'live' && status !== 'ended') throw fail(400, 'bad_input');
      const existing = await getPromoById(tx, id);
      if (!existing) throw fail(404, 'not_found');
      await setPromoStatus(tx, id, status as PromoStatus);
      return { code: 'promo_status', target: `promo:${existing.slug}`, detail: { status } };
    },

    // The monthly draw. The pool is recomputed from saved answers inside this same transaction, and the
    // draw row (pool, seed, winners) is the record of it; a drawn month refuses a second draw, and a month
    // that has not ended yet refuses a first one (drawing it would lock out the rest of the month).
    async 'promo.draw'({ tx, form, admin, now }) {
      const id = promoId(form, fail);
      const month = field(form, 'month');
      if (!MONTH.test(month)) throw fail(400, 'bad_input');
      if (!monthEnded(month, now)) throw fail(400, 'promo_month_open');
      const promo = await getPromoById(tx, id);
      if (!promo) throw fail(404, 'not_found');
      if (promo.type !== 'streak_draw') throw fail(400, 'bad_input');
      const r = await runDraw(tx, promo, month, admin.email, now);
      if (!r.ok) throw fail(409, r.code === 'already_drawn' ? 'promo_already_drawn' : 'promo_empty_pool');
      return {
        code: 'promo_drawn',
        target: `promo:${promo.slug}`,
        detail: { month, pool: r.draw.poolSize, winners: r.draw.winners.length },
      };
    },
  };
}
