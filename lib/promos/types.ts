// The promotion type registry: the one place a mechanic is named. A promotion record carries a `type`; the
// public pages, the admin pages and the entry route all switch on this registry, so a future type plugs in by
// adding one entry here, its panel on the promo page, and (only if it needs one) an admin section — the index
// page, the promo page shell and the record storage never change. Unknown types render the generic record
// (title, description, prize, rules) with no mechanic panel, and cannot take entries. No Next.js imports.

export type PromoStatus = 'draft' | 'live' | 'ended';

export type PromoTypeDef = {
  label: string;
  // Whether this type takes account entries through the standard entry route.
  takesEntries: boolean;
};

export const PROMO_TYPES = {
  // Type #1 (19 November 2026): answer the Question of the Day correctly N days in a row (a small freeze
  // allowance forgives a missed day), enter once, and each month's completers go into a recorded random draw.
  streak_draw: { label: 'Streak draw', takesEntries: true },
} as const satisfies Record<string, PromoTypeDef>;

export type PromoType = keyof typeof PROMO_TYPES;

export const isPromoType = (v: string): v is PromoType => Object.hasOwn(PROMO_TYPES, v);
export const promoTypeDef = (v: string): PromoTypeDef | null => (isPromoType(v) ? PROMO_TYPES[v] : null);

// The streak_draw settings, read from the record's config jsonb with the shipped defaults as fallback, so an
// admin edit that clears a field can never produce a nonsense mechanic.
export type StreakConfig = { targetDays: number; freezeAllowance: number; winnersPerDraw: number };

const whole = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback;

export function streakConfig(config: Record<string, unknown>): StreakConfig {
  return {
    targetDays: whole(config.targetDays, 10, 2, 60),
    freezeAllowance: whole(config.freezeAllowance, 1, 0, 7),
    winnersPerDraw: whole(config.winnersPerDraw, 5, 1, 50),
  };
}
