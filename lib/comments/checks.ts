// The mechanical checks every new or edited comment passes (plan 7A), in order: rate limit, length, blocked words,
// duplicate, link policy. "Banned" is checked first by the caller, from the locked trust row. Pure; the caller counts
// `recent` inside the same transaction. Verified by tests/unit/comments-checks.test.ts.
import { findBlockedWord } from '@/lib/items/blocked';
import { foldMarks } from '@/lib/circles/rules';
import { COMMENT_LIMITS, hasLinkLike, normaliseBody } from './rules';

export type CheckCode = 'length' | 'blocked' | 'link' | 'duplicate' | 'rate';
export type Recent = { sameBodyByAuthor24h: boolean; sameBodyOnItem: boolean; last10min: number; last24h: number };
export type CheckResult = { ok: true; body: string; hasLink: boolean } | { ok: false; code: CheckCode };

export function checkComment(input: { body: unknown; trustLevel: 0 | 1; recent: Recent }): CheckResult {
  const { recent } = input;
  if (recent.last10min >= COMMENT_LIMITS.per10min || recent.last24h >= COMMENT_LIMITS.perDay) {
    return { ok: false, code: 'rate' };
  }
  const body = normaliseBody(input.body);
  const len = body === null ? 0 : [...body].length;
  if (body === null || len < 1 || len > COMMENT_LIMITS.body) {
    return { ok: false, code: 'length' };
  }
  if (findBlockedWord(body) || findBlockedWord(foldMarks(body))) {
    return { ok: false, code: 'blocked' };
  }
  if (recent.sameBodyByAuthor24h || recent.sameBodyOnItem) {
    return { ok: false, code: 'duplicate' };
  }
  const hasLink = hasLinkLike(body);
  if (hasLink && input.trustLevel < 1) {
    return { ok: false, code: 'link' };
  }
  return { ok: true, body, hasLink };
}
