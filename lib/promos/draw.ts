// The monthly draw for a `streak_draw` promotion: a recorded, recomputable random pick. The pool is the
// promotion's entrants whose account-holder streak completed in the drawn month (derived live from
// item_responses by the streak engine — never a stored claim). The draw records the pool size, a fresh random
// seed, the method and the winners, so anyone with the seed and the pool can recompute the same winners with
// drawWinners below. One draw per promotion per month; a drawn month is never redrawn. No Next.js imports.
// Verified by tests/unit/promos-repo.test.ts.
import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '@/lib/db';
import { isUuid } from '@/lib/accounts/pin';
import { listEntries, type Promo } from './repo';
import { streakForOwner } from './streak';
import { streakConfig } from './types';

export const DRAW_METHOD =
  'sha256(seed) seeds a mulberry32 PRNG; a Fisher-Yates shuffle of the entrant account ids sorted ascending; the first N shuffled ids win. Recompute with drawWinners(poolIds, seed, n).';

// mulberry32: a tiny deterministic PRNG, seeded from the first 32 bits of the seed's sha256.
function rng(seed: string): () => number {
  let a = createHash('sha256').update(seed).digest().readUInt32BE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The winners of a draw, in winning order. The pool is sorted before shuffling, so the result depends only on
// (pool membership, seed, count) — never on the order the pool was listed in.
export function drawWinners(pool: readonly string[], seed: string, count: number): string[] {
  const ids = [...pool].sort();
  const rand = rng(seed);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, Math.max(0, Math.min(count, ids.length)));
}

export type EntrantStanding = { accountId: string; email: string; enteredAt: Date; completedInMonth: boolean };

// Every entrant with whether their account-holder streak completed in `month` (YYYY-MM). Admin use only
// (emails); the pool for a draw is the account ids of the rows where completedInMonth is true.
export async function entrantStandings(db: Queryable, promo: Promo, month: string, now: Date): Promise<EntrantStanding[]> {
  const cfg = streakConfig(promo.config);
  const entries = await listEntries(db, promo.id);
  const out: EntrantStanding[] = [];
  for (const e of entries) {
    const s = await streakForOwner(db, { accountId: e.accountId, profileId: null }, now, cfg);
    out.push({
      accountId: e.accountId,
      email: e.email,
      enteredAt: e.enteredAt,
      completedInMonth: s.completedOn.some((d) => d.startsWith(month)),
    });
  }
  return out;
}

export type Draw = {
  id: string;
  month: string;
  poolSize: number;
  seed: string;
  method: string;
  winners: string[];
  drawnBy: string;
  drawnAt: Date;
};

type DrawRow = {
  id: string;
  month: string;
  pool_size: number;
  seed: string;
  method: string;
  winners: string[];
  drawn_by: string;
  drawn_at: Date;
};

const toDraw = (r: DrawRow): Draw => ({
  id: r.id,
  month: r.month,
  poolSize: r.pool_size,
  seed: r.seed,
  method: r.method,
  winners: r.winners ?? [],
  drawnBy: r.drawn_by,
  drawnAt: r.drawn_at,
});

export async function listDraws(q: Queryable, promotionId: string): Promise<Draw[]> {
  if (!isUuid(promotionId)) return [];
  const r = await q.query<DrawRow>(
    'SELECT id, month, pool_size, seed, method, winners, drawn_by, drawn_at FROM promo_draws WHERE promotion_id = $1 ORDER BY month DESC',
    [promotionId],
  );
  return r.rows.map(toDraw);
}

export async function getDraw(q: Queryable, promotionId: string, month: string): Promise<Draw | null> {
  if (!isUuid(promotionId)) return null;
  const r = await q.query<DrawRow>(
    'SELECT id, month, pool_size, seed, method, winners, drawn_by, drawn_at FROM promo_draws WHERE promotion_id = $1 AND month = $2',
    [promotionId, month],
  );
  return r.rows[0] ? toDraw(r.rows[0]) : null;
}

// Runs and records the draw for a month inside the caller's transaction. Refuses (returns a code, writes
// nothing) when the month was already drawn or the pool is empty.
export async function runDraw(
  tx: Queryable,
  promo: Promo,
  month: string,
  drawnBy: string,
  now: Date,
): Promise<{ ok: true; draw: Draw } | { ok: false; code: 'already_drawn' | 'empty_pool' }> {
  if (await getDraw(tx, promo.id, month)) return { ok: false, code: 'already_drawn' };
  const standings = await entrantStandings(tx, promo, month, now);
  const pool = standings.filter((s) => s.completedInMonth).map((s) => s.accountId);
  if (pool.length === 0) return { ok: false, code: 'empty_pool' };
  const cfg = streakConfig(promo.config);
  const seed = randomBytes(24).toString('hex');
  const winners = drawWinners(pool, seed, cfg.winnersPerDraw);
  const r = await tx.query<DrawRow>(
    `INSERT INTO promo_draws (promotion_id, month, pool_size, seed, method, winners, drawn_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id, month, pool_size, seed, method, winners, drawn_by, drawn_at`,
    [promo.id, month, pool.length, seed, DRAW_METHOD, JSON.stringify(winners), drawnBy],
  );
  return { ok: true, draw: toDraw(r.rows[0]) };
}
