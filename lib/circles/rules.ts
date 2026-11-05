// Circle rules (plan 4A, spec Project 4): limits, input validation and who may create which kind. Pure functions, no I/O,
// no Next.js imports. Verified by tests/unit/circles-repo.test.ts.
import { can, type AgeGroup, type Consent } from '@/lib/accounts/policy';
import { TIME_ZONES } from '@/lib/accounts/settings';
import { findBlockedWord } from '@/lib/items/blocked';

export const LIMITS = {
  ownedOpen: 5,
  memberOf: 10,
  members: 30,
  name: 40,
  description: 200,
  memberName: 30,
} as const;

export const KINDS = ['friends', 'family', 'community'] as const;
export type CircleKind = (typeof KINDS)[number];

export type CircleInput = {
  name: string;
  kind: CircleKind;
  description: string | null;
  timeZone: string;
  yourName: string;
};

const ZONES = new Set<string>(TIME_ZONES);

// A scheme (http://), www. or a domain-like word (evil.com): names and descriptions reach invite emails and pages, so
// they never carry a link (4B security review). Unicode-aware: any letter or digit, and the ideographic and halfwidth
// dots NFKC leaves or makes (。 ｡), count; the text is NFKC-normalised before the test.
export const LINK_LIKE = /\p{L}[\p{L}\p{M}\p{N}+.-]*:\/\/|www[.。．｡]|[\p{L}\p{M}\p{N}_-]+[.。．｡]\p{M}*(?:[\p{L}\p{N}]\p{M}*){2,}/iu;

// The text with its combining marks removed (NFD, then no \p{M}): "f\u0301uck" reads as "fuck" to the blocked-word test.
export const foldMarks = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '');

// Trimmed NFKC text of 1..max characters, no control, format or default-ignorable characters (blank-looking Hangul
// fillers), no blocked word (also behind combining marks), nothing link-like; otherwise null.
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  const s = v.normalize('NFKC').trim();
  const len = [...s].length;
  const hidden = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(s);
  if (len < 1 || len > max || hidden || LINK_LIKE.test(s) || findBlockedWord(s) || findBlockedWord(foldMarks(s))) {
    return null;
  }
  return s;
}

// The name a member is shown by inside one circle. No '@', so an address is never used (and shown) as a name.
export function cleanMemberName(v: unknown): string | null {
  const s = cleanText(v, LIMITS.memberName);
  return s && !s.includes('@') ? s : null;
}

const isKind = (v: unknown): v is CircleKind => KINDS.includes(v as CircleKind);

// A description belongs to community circles only and may be empty; for other kinds it is dropped.
function cleanDescription(kind: CircleKind, v: unknown): string | null | false {
  if (kind !== 'community' || v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    return null;
  }
  return cleanText(v, LIMITS.description) ?? false;
}

export function validateCircleInput(
  input: unknown,
  defaultZone = 'UTC',
): { ok: true; value: CircleInput } | { ok: false } {
  if (typeof input !== 'object' || input === null) {
    return { ok: false };
  }
  const i = input as Record<string, unknown>;
  const name = cleanText(i.name, LIMITS.name);
  const yourName = cleanMemberName(i.yourName);
  const timeZone = i.timeZone === undefined || i.timeZone === '' ? defaultZone : i.timeZone;
  if (!name || !yourName || !isKind(i.kind) || typeof timeZone !== 'string' || !ZONES.has(timeZone)) {
    return { ok: false };
  }
  const description = cleanDescription(i.kind, i.description);
  if (description === false) {
    return { ok: false };
  }
  return { ok: true, value: { name, kind: i.kind, description, timeZone, yourName } };
}

// Rulings (plan 4A): family and community circles are created by 18+ only; teens with the capability create friends.
export const canCreateKind = (group: AgeGroup, consent: Consent, kind: CircleKind): boolean =>
  can(group, consent, 'create_circle') && (kind === 'friends' || group === 'adult');
