// Sponsorship rules (plan 6, spec Project 6 and 4a.3): the allowed and excluded sponsor categories, the two fixed
// disclosure sentences, and validation of what the owner enters in /admin. The excluded categories are never in the
// allowed list, so no request shape can store one (the database CHECK in 025_sponsorship.sql backs this). The label is
// link text only; the disclosure cannot be edited per sponsorship. Pure functions, no I/O, no Next.js imports.
// Verified by tests/unit/sponsorship-rules.test.ts.
import { isSafeSourceUrl } from '@/lib/items/gates';

export const ALLOWED_CATEGORIES = [
  'education',
  'books',
  'software',
  'services',
  'health-and-wellbeing-general',
  'finance-education',
  'travel',
  'food',
  'other-approved',
] as const;

// Spec 4a.3, shown in /admin as the list a sponsor must not belong to; never selectable.
export const EXCLUDED_CATEGORIES = [
  'gambling',
  'alcohol',
  'tobacco and vaping',
  'weapons',
  'adult content',
  'payday lending',
  'cryptocurrency and get-rich schemes',
  'supplements and weight-loss products',
  'political and religious organisations',
  'anything marketed to children',
] as const;

export type Category = (typeof ALLOWED_CATEGORIES)[number];
export type SponsorshipKind = 'supported' | 'affiliate';
export type TargetType = 'item' | 'topic' | 'world';

const TARGET_WORDS: Record<TargetType, string> = { item: 'This piece', topic: 'This topic', world: 'This section' };

export function disclosureFor(kind: SponsorshipKind, target: TargetType, sponsorName: string): string {
  if (kind === 'affiliate') {
    return 'SparkKindly earns a commission if you buy through this link.';
  }
  return `${TARGET_WORDS[target]} is supported by ${sponsorName}. ${sponsorName} had no say in what we publish.`;
}

type Result<T> = { ok: true; value: T } | { ok: false };
const fail = { ok: false } as const;

const str = (v: unknown): string | null => (typeof v === 'string' ? v.trim() : null);
const sized = (v: unknown, max: number): string | null => {
  const s = str(v);
  return s && s.length <= max ? s : null;
};
const isCategory = (v: unknown): v is Category => (ALLOWED_CATEGORIES as readonly unknown[]).includes(v);

export type SponsorInput = { name: string; link: string; category: Category };

export function validateSponsor(input: Record<string, unknown>): Result<SponsorInput> {
  const name = sized(input.name, 80);
  const link = sized(input.link, 500);
  const category = input.category;
  // A control character inside the link is refused (the URL parser would silently drop a newline or tab).
  if (!name || !link || /\p{Cc}/u.test(link) || !isSafeSourceUrl(link) || !isCategory(category) || !input.confirmed) {
    return fail;
  }
  // Stored in the parser's ASCII form (punycode host, percent-encoded path), so it is always a valid Location header.
  return { ok: true, value: { name, link: new URL(link).href, category } };
}

// A real YYYY-MM-DD calendar date (UTC), or null for none; undefined for an invalid value.
function day(v: unknown): string | null | undefined {
  const s = str(v);
  if (!s) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return undefined;
  }
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : undefined;
}

export type SponsorshipInput = {
  sponsorId: number;
  target: TargetType;
  targetRef: string;
  label: string;
  kind: SponsorshipKind;
  startsOn: string | null;
  endsOn: string | null;
};

export function validateSponsorship(input: Record<string, unknown>): Result<SponsorshipInput> {
  const id = str(input.sponsorId);
  const target = input.target;
  const targetRef = sized(input.targetRef, 200);
  const label = sized(input.label, 60);
  const kind = input.kind;
  const startsOn = day(input.startsOn);
  const endsOn = day(input.endsOn);
  if (!id || !/^\d{1,9}$/.test(id) || !targetRef || !label) {
    return fail;
  }
  if (target !== 'item' && target !== 'topic' && target !== 'world') {
    return fail;
  }
  if ((kind !== 'supported' && kind !== 'affiliate') || startsOn === undefined || endsOn === undefined) {
    return fail;
  }
  if (startsOn && endsOn && endsOn < startsOn) {
    return fail;
  }
  return { ok: true, value: { sponsorId: Number(id), target, targetRef, label, kind, startsOn, endsOn } };
}

// The UTC calendar date of an instant: the "today" every window check uses, so no server time zone matters.
export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);
