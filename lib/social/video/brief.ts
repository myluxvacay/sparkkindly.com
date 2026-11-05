// The promoter's video brief, checked by the server (plan 5B; ai-governance.md: AI output is untrusted). Every text in
// it (narration, shots, on-screen lines, captions) goes through the 5A caption rules (checkCopy: NFKC, no URL, domain,
// dot-like character, obfuscated domain, mention, # in text, control, bidi or default-ignorable character, blocked
// word) and the normalised form is what is stored. Limits: narration up to 1,200 characters, 3 to 12 shots of up to
// 200, up to 12 on-screen lines of up to 60, 15 to 60 seconds, at most 8 hashtags (5A rules); captions for the job's own platform
// only: TikTok up to 2,000, YouTube a one-line title up to 100 and a description up to 1,000. Unknown fields (an
// agent-chosen asset, platform or schedule) are refused. The brand assets are built here from the world, never by the
// agent. No Next.js imports. Verified by tests/unit/social-video-brief.test.ts.
import { z } from 'zod';
import { worldHex } from '@/lib/public/palette';
import { checkCopy, MAX_HASHTAGS } from '../copy';
import type { VideoPlatform } from '../states';

export const LIMITS = { narration: 1200, shot: 200, minShots: 3, maxShots: 12, onScreen: 60, maxOnScreen: 12, tiktok: 2000, title: 100, description: 1000 };
const FRAMES = ['title-card', 'end-card'];

export type Captions = { tiktok?: string; youtube?: { title: string; description: string } };
export type Brief = {
  narration: string;
  shots: string[];
  onScreenText: string[];
  captions: Captions;
  hashtags: string[];
  durationSeconds: number;
};
export type BriefCheck = { ok: true; brief: Brief } | { ok: false; field: string; reason: string };

const str = z.string().max(4000);
export const briefShape = z.strictObject({
  narration: str,
  shots: z.array(str).max(40),
  onScreenText: z.array(str).max(40),
  captions: z.strictObject({
    tiktok: str.optional(),
    youtube: z.strictObject({ title: str, description: str }).optional(),
  }),
  hashtags: z.array(z.string().max(60)).max(MAX_HASHTAGS),
  durationSeconds: z.number().int().min(15).max(60),
});

export const brandAssets = (worldColor: string) => ({ logo: '/brand/sparkkindly-logo.png', worldColour: worldHex(worldColor), frames: [...FRAMES] });

class Refused extends Error {
  constructor(public readonly field: string, public readonly reason: string) {
    super(reason);
  }
}

// One text through the caption rules and a length limit; the NFKC form back.
function text(platform: VideoPlatform, field: string, s: string, limit: number): string {
  const c = checkCopy(platform, { caption: s, hashtags: [] });
  if (!c.ok) throw new Refused(field, c.reason);
  if ([...c.copy.caption].length > limit) throw new Refused(field, 'length');
  return c.copy.caption;
}

function captions(platform: VideoPlatform, c: Captions): Captions {
  if (platform === 'tiktok') {
    if (c.tiktok === undefined) throw new Refused('captions', 'missing');
    return { tiktok: text(platform, 'captions', c.tiktok, LIMITS.tiktok) };
  }
  if (!c.youtube) throw new Refused('captions', 'missing');
  if (/[\r\n]/.test(c.youtube.title)) throw new Refused('captions', 'title_line_break');
  return {
    youtube: {
      title: text(platform, 'captions', c.youtube.title, LIMITS.title),
      description: text(platform, 'captions', c.youtube.description, LIMITS.description),
    },
  };
}

function check(platform: VideoPlatform, b: z.infer<typeof briefShape>): Brief {
  if (b.shots.length < LIMITS.minShots || b.shots.length > LIMITS.maxShots) throw new Refused('shots', 'count');
  if (b.onScreenText.length > LIMITS.maxOnScreen) throw new Refused('onScreenText', 'count');
  const tags = checkCopy(platform, { caption: 'x', hashtags: b.hashtags });
  if (!tags.ok) throw new Refused('hashtags', tags.reason);
  return {
    narration: text(platform, 'narration', b.narration, LIMITS.narration),
    shots: b.shots.map((s) => text(platform, 'shots', s, LIMITS.shot)),
    onScreenText: b.onScreenText.map((s) => text(platform, 'onScreenText', s, LIMITS.onScreen)),
    captions: captions(platform, b.captions),
    hashtags: tags.copy.hashtags,
    durationSeconds: b.durationSeconds,
  };
}

export function validateBrief(input: unknown, platform: VideoPlatform): BriefCheck {
  const parsed = briefShape.safeParse(input);
  if (!parsed.success) return { ok: false, field: 'shape', reason: 'shape' };
  try {
    return { ok: true, brief: check(platform, parsed.data) };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, field: err.field, reason: err.reason };
    throw err;
  }
}

// The text the distribution row carries for the overview: TikTok's caption, YouTube's title.
export const mainCaption = (b: Brief): string => b.captions.tiktok ?? b.captions.youtube?.title ?? '';
