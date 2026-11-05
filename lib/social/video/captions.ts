// Checks a caption file (plan 5B; accessibility.md: all video requires captions). Up to 200 KB of valid UTF-8 text, no
// control character other than tab and line breaks, at least one cue timing line; WebVTT starts with `WEBVTT` (a BOM is
// allowed) and may use the WebVTT cue tags (b, i, u, c, v, lang, ruby, rt) but no other markup; SRT uses
// `00:00:00,000 --> 00:00:00,000` timings and no markup. No Next.js imports. Verified by tests/unit/social-video-upload.test.ts.
import { MAX_CAPTIONS_BYTES } from './upload';

export type CaptionsCheck = { ok: true } | { ok: false; reason: string };

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const VTT_CUE = /^(\d{2,}:)?\d{2}:\d{2}\.\d{3} --> (\d{2,}:)?\d{2}:\d{2}\.\d{3}/m;
const SRT_CUE = /^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/m;
const VTT_TAG = /<\/?(b|i|u|c|v|lang|ruby|rt)(\.[\w.-]+)?( [^<>]{0,80})?>|<\d{2}:\d{2}(:\d{2})?\.\d{3}>/g;

export function validateCaptions(bytes: Buffer, ext: 'vtt' | 'srt'): CaptionsCheck {
  if (bytes.length === 0 || bytes.length > MAX_CAPTIONS_BYTES) return { ok: false, reason: 'size' };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return { ok: false, reason: 'not_utf8' };
  }
  if (CONTROL.test(text)) return { ok: false, reason: 'control_character' };
  if (ext === 'vtt') {
    if (!/^WEBVTT([ \t].*)?(\r?\n|$)/.test(text)) return { ok: false, reason: 'not_webvtt' };
    if (!VTT_CUE.test(text)) return { ok: false, reason: 'no_cues' };
    if (text.replace(VTT_TAG, '').includes('<')) return { ok: false, reason: 'markup' };
    return { ok: true };
  }
  if (!SRT_CUE.test(text)) return { ok: false, reason: 'no_cues' };
  if (text.includes('<')) return { ok: false, reason: 'markup' };
  return { ok: true };
}
