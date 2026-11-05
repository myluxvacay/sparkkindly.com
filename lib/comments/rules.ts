// Comment rules (plan 7A, spec Project 7): limits, who may comment, body normalisation and the display name.
// Pure functions, no I/O, no Next.js imports. Verified by tests/unit/comments-checks.test.ts.
import { can, type AgeGroup, type Consent } from '@/lib/accounts/policy';
import { LINK_LIKE, cleanMemberName, foldMarks } from '@/lib/circles/rules';

export const COMMENT_LIMITS = {
  body: 1000,
  name: 30,
  editMs: 15 * 60_000,
  per10min: 5,
  perDay: 40,
} as const;

// Approvals (with no rejection since the last drop) that move an account from level 0 to level 1.
export const TRUST_THRESHOLD = 5;

export const mayComment = (group: AgeGroup | null, consent: Consent): boolean =>
  group !== null && can(group, consent, 'public_comment');

// NFKC, line breaks kept as \n, every other control and format character and every default-ignorable code point
// (zero-width tricks, Hangul fillers) dropped, trimmed. The result may be empty; checkComment refuses that.
export function normaliseBody(v: unknown): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  return v
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]|(?!\n)\p{Cc}/gu, '')
    .trim();
}

// The shared link-like check of lib/circles/rules.ts (scheme, www., domain-like), on normalised text.
export const hasLinkLike = (s: string): boolean => LINK_LIKE.test(s);

// Names that would pass for the site or its staff (7A review L3), compared without case or spaces.
const RESERVED = new Set(['sparkkindly', 'admin', 'administrator', 'moderator', 'mod', 'owner', 'staff', 'support', 'team']);

// The name shown beside comments: 1-30 characters after NFKC, no '@', no blocked word (also behind combining marks),
// nothing link-like, nothing default-ignorable (a blank-looking name), not a reserved name.
export function cleanDisplayName(v: unknown): string | null {
  const name = cleanMemberName(v);
  return name && !RESERVED.has(foldMarks(name).toLowerCase().replace(/\s+/g, '')) ? name : null;
}

export const ticked = (v: unknown): boolean => v === true || v === 'on' || v === 'true';
