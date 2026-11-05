// Comment rules (plan 7A, spec Project 7): limits, who may comment, body normalisation and the display name.
// Pure functions, no I/O, no Next.js imports. Verified by tests/unit/comments-checks.test.ts.
import { can, type AgeGroup, type Consent } from '@/lib/accounts/policy';
import { LINK_LIKE, cleanMemberName } from '@/lib/circles/rules';

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

// NFKC, line breaks kept as \n, every other control and format character (zero-width tricks) dropped, trimmed.
// The result may be empty; checkComment refuses that.
export function normaliseBody(v: unknown): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  return v
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\p{Cf}]|(?!\n)\p{Cc}/gu, '')
    .trim();
}

// The shared link-like check of lib/circles/rules.ts (scheme, www., domain-like), on normalised text.
export const hasLinkLike = (s: string): boolean => LINK_LIKE.test(s);

// The name shown beside comments: 1-30 characters after NFKC, no '@', no blocked word, nothing link-like.
export const cleanDisplayName = (v: unknown): string | null => cleanMemberName(v);

export const ticked = (v: unknown): boolean => v === true || v === 'on' || v === 'true';
