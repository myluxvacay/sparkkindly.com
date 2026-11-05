// The promotion agent's copy, checked by the server (plan 5A, ai-governance.md: AI output is untrusted). Caption and
// hashtags are NFKC-normalised first and the normalised form is what is stored and posted. A caption is plain text: no
// URL, scheme, `www`, domain (any script, any dot-like character, combining marks included; the shared detector from
// lib/circles/rules.ts), obfuscated domain (`evil[.]com`, `evil (.) com`, `evil .com`), `@` or `#` (tags go in
// `hashtags`, at most 8, letters, digits and _ only), no control character other than a line break, no format or
// default-ignorable character (bidi marks, zero-width spaces, Hangul fillers; the emoji joiner and presentation selectors
// excepted), no blocked word (also behind combining marks) or blocked-topic phrasing. Limits: caption 1 to 2,000
// characters; Facebook 500 (our choice); Instagram 2,200 for the whole posted text. The posted text is built here from
// the stored caption, hashtags and the server's link, so what is posted is exactly what was validated.
// No Next.js imports. Verified by tests/unit/social-promotions-api.test.ts.
import { foldMarks, LINK_LIKE } from '@/lib/circles/rules';
import { findBlockedTopic, findBlockedWord } from '@/lib/items/blocked';
import type { Platform } from './states';

export type Copy = { caption: string; hashtags: string[] };
export type CopyCheck = { ok: true; copy: Copy } | { ok: false; reason: string };

export const MAX_HASHTAGS = 8;
export const CAPTION_LIMIT: Record<Platform, number> = { instagram: 2000, facebook: 500, tiktok: 2000, youtube: 2000 };
const TOTAL_LIMIT: Partial<Record<Platform, number>> = { instagram: 2200 };
const HASHTAG = /^[\p{L}\p{N}_]{2,30}$/u;
// Refused in the raw text, before NFKC can fold them: dot-like characters and the fullwidth @.
const RAW_FORBIDDEN = /[。．｡․﹒＠@]/u;
const LINK_PATTERNS = [
  LINK_LIKE,
  /[a-z][a-z0-9+.-]{1,20}:\S/i, // a scheme without slashes (javascript:, mailto:)
  /\bwww\b/i,
  /[/\\]{2}/,
  /[\p{L}\p{N}]\s?[[(]\s?\.\s?[\])]\s?[\p{L}\p{N}]{2,}/u, // evil[.]com, evil (.) com
  /[\p{L}\p{N}]\s\.\p{L}{2,}/u, // evil .com
];
// Line break allowed; ZWJ (U+200D) and VS15/VS16 (U+FE0E, U+FE0F) allowed inside emoji.
const HIDDEN = /(?![\n‍︎️])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

const blocked = (s: string) => !!(findBlockedWord(s) || findBlockedWord(foldMarks(s)));

function captionProblem(caption: string): string | null {
  if (HIDDEN.test(caption)) return 'control_or_format_character';
  if (LINK_PATTERNS.some((p) => p.test(caption))) return 'link';
  if (caption.includes('@')) return 'mention';
  if (caption.includes('#')) return 'hashtag_in_caption';
  if (blocked(caption) || findBlockedTopic(caption) || findBlockedTopic(foldMarks(caption))) return 'blocked';
  return null;
}

export function checkCopy(platform: Platform, raw: Copy): CopyCheck {
  if (typeof raw.caption !== 'string' || !Array.isArray(raw.hashtags) || raw.hashtags.length > MAX_HASHTAGS) {
    return { ok: false, reason: 'shape' };
  }
  if (!raw.hashtags.every((h) => typeof h === 'string')) return { ok: false, reason: 'hashtags' };
  if (RAW_FORBIDDEN.test(raw.caption)) return { ok: false, reason: 'link' };
  const caption = raw.caption.normalize('NFKC');
  const hashtags = raw.hashtags.map((h) => h.normalize('NFKC'));
  const length = [...caption].length;
  if (caption.trim().length === 0 || length > CAPTION_LIMIT[platform]) return { ok: false, reason: 'caption_length' };
  if (!hashtags.every((h) => HASHTAG.test(h))) return { ok: false, reason: 'hashtags' };
  if (hashtags.some(blocked)) return { ok: false, reason: 'blocked' };
  const problem = captionProblem(caption);
  if (problem) return { ok: false, reason: problem };
  const total = TOTAL_LIMIT[platform];
  if (total && [...postText(platform, { caption, hashtags, link: '' })].length > total) return { ok: false, reason: 'caption_length' };
  return { ok: true, copy: { caption, hashtags } };
}

// What goes to the platform. Instagram captions carry no link (it would not be clickable); Facebook's carries the
// server-built link.
export function postText(platform: Platform, d: Copy & { link: string }): string {
  const tags = d.hashtags.map((h) => `#${h}`).join(' ');
  const parts = [d.caption, platform === 'facebook' ? d.link : '', tags].filter(Boolean);
  return parts.join('\n\n');
}

const LATEST_HOUR_UTC = 20;

// When accepted copy is posted: the platform's time (HH:MM[:SS], UTC) today, held at 20:00; if that has passed, now;
// from 20:00 UTC on, the platform's time tomorrow.
export function scheduleTime(postTimeUtc: string, now: Date): Date {
  const [h, m] = postTimeUtc.split(':').map(Number);
  const minutes = Math.min(h * 60 + m, LATEST_HOUR_UTC * 60);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const at = new Date(today.getTime() + minutes * 60_000);
  if (at > now) return at;
  if (now.getUTCHours() < LATEST_HOUR_UTC) return now;
  return new Date(at.getTime() + 24 * 3_600_000);
}
