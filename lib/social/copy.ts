// The promotion agent's copy, checked by the server (plan 5A, ai-governance.md: AI output is untrusted). A caption is
// plain text: no URL, domain, scheme, `www`, `@` mention or `#` tag (tags go in `hashtags`, at most 8, letters, digits
// and _ only), no control character other than a line break, no bidi or invisible formatting character (a zero-width
// joiner inside emoji is allowed), no blocked word or blocked-topic phrasing. Limits: caption 1 to 2,000 characters;
// Facebook 500 (our choice); Instagram 2,200 for the whole posted text. The text posted is built here from the stored
// caption, hashtags and the server's link, so what is posted is exactly what was validated. No Next.js imports.
// Verified by tests/unit/social-promotions-api.test.ts.
import { findBlockedTopic, findBlockedWord } from '@/lib/items/blocked';
import type { Platform } from './states';

export type Copy = { caption: string; hashtags: string[] };
export type CopyCheck = { ok: true } | { ok: false; reason: string };

export const MAX_HASHTAGS = 8;
export const CAPTION_LIMIT: Record<Platform, number> = { instagram: 2000, facebook: 500, tiktok: 2000, youtube: 2000 };
const TOTAL_LIMIT: Partial<Record<Platform, number>> = { instagram: 2200 };
const HASHTAG = /^[\p{L}\p{N}_]{2,30}$/u;
const LINK_LIKE = [
  /[a-z][a-z0-9+.-]{1,20}:[^\s]/i, // a scheme (https:, javascript:, mailto:...)
  /\bwww\b/i,
  /[\p{L}\p{N}-]\.[a-z]{2,}\b/iu, // a domain (example.com, evil.example)
  /[/\\]{2}/,
];
// Controls other than \n; format characters (bidi marks and overrides, zero-width space, BOM...) other than U+200D.
const FORBIDDEN_CHAR = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]|(?!‍)\p{Cf}/u;

function captionProblem(caption: string): string | null {
  if (FORBIDDEN_CHAR.test(caption)) return 'control_or_format_character';
  if (LINK_LIKE.some((p) => p.test(caption))) return 'link';
  if (caption.includes('@')) return 'mention';
  if (caption.includes('#')) return 'hashtag_in_caption';
  if (findBlockedWord(caption) || findBlockedTopic(caption)) return 'blocked';
  return null;
}

export function checkCopy(platform: Platform, copy: Copy): CopyCheck {
  const { caption, hashtags } = copy;
  if (typeof caption !== 'string' || caption.trim().length === 0) return { ok: false, reason: 'caption_length' };
  if ([...caption].length > CAPTION_LIMIT[platform]) return { ok: false, reason: 'caption_length' };
  if (!Array.isArray(hashtags) || hashtags.length > MAX_HASHTAGS) return { ok: false, reason: 'hashtags' };
  if (!hashtags.every((h) => typeof h === 'string' && HASHTAG.test(h))) return { ok: false, reason: 'hashtags' };
  if (hashtags.some((h) => findBlockedWord(h))) return { ok: false, reason: 'blocked' };
  const problem = captionProblem(caption);
  if (problem) return { ok: false, reason: problem };
  const total = TOTAL_LIMIT[platform];
  if (total && [...postText(platform, { caption, hashtags, link: '' })].length > total) return { ok: false, reason: 'caption_length' };
  return { ok: true };
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
