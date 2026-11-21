import { z } from 'zod';
import { brandSchema, dateSchema } from '@/lib/schemas';

// The Content Push API package format (docs/content-push-api.md). A package carries content in the LIBRARY
// shapes (lib/schemas.ts articleSchema / quizSchema) — the same JSON an agent would otherwise commit to
// content/articles and content/quizzes — minus every server-owned field. Stripped on purpose (unknown keys
// are dropped by zod, exactly as in lib/items/format.ts):
// - reviewStatus / reviewer / reviewedAt / reviewNote: the workflow belongs to the server and the reviewer
//   agent, never to the submitter. An item's approval state is its row status, not a field in the payload.
// - publishedAt (articles) and scheduledDate (quizzes): the server assigns dates. A quiz's scheduledDate is
//   handed out at approval time from the global quiz calendar, so two agents can never pick the same day.
// Stricter than the file schemas where the handoff demands it: sources are REQUIRED (at least one, https,
// never our own site) on articles and quizzes alike — content:validate tolerates an empty list in a file,
// the API does not. The five substantive Kids fields are likewise required on EVERY Kids item, quizzes
// included (the file schema carries them only on articles/activities; the API's rule is the handoff's:
// a Kids item without them is refused, whoever sends it).

const ownSite = (url: string) => URL.canParse(url) && /(^|\.)sparkkindly\.com\.?$/i.test(new URL(url).hostname);
const sourceSchema = z.object({
  title: z.string().min(1),
  url: z
    .url()
    .startsWith('https://')
    .refine((u) => !ownSite(u), 'Sources cannot be on sparkkindly.com'),
  accessedAt: dateSchema,
});

const mediaSchema = z.object({
  src: z.string().startsWith('/images/'),
  alt: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  credit: z.string().min(1),
  rights: z.string().min(1),
});

export const pushArticleSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    brand: brandSchema,
    contentType: z.enum(['article', 'activity']), // a 'video' library item is not pushable; use the video component
    title: z.string().min(1),
    description: z.string().min(1),
    updatedAt: dateSchema,
    author: z.string().min(1),
    ageGuidance: z.string().optional(),
    hero: mediaSchema.optional(), // an existing /images/ asset; omit it and upload the hero via the image endpoint
    tags: z.array(z.string()).default([]),
    sources: z.array(sourceSchema).min(1, 'at least one source is required').max(10),
    factualClaimsReviewedAt: dateSchema.nullable().optional(),
    aiDisclosure: z.string().min(1),
    body: z
      .array(z.object({ heading: z.string().min(1), paragraphs: z.array(z.string().min(1)).min(1) }))
      .min(2),
    takeaway: z.string().min(1),
    fiction: z.boolean().default(false),
    correctionNote: z.string().optional(),
    materials: z.array(z.string()).optional(),
    supervision: z.string().optional(),
    safetyNotes: z.array(z.string()).optional(),
    screenFreeExtension: z.string().optional(),
  })
  .superRefine((a, c) => {
    // The Kids five fields, verbatim from articleSchema: schema-enforced, never a reviewer's judgement call.
    if (a.brand === 'kids' && (!a.ageGuidance || !a.materials?.length || !a.supervision || !a.safetyNotes?.length || !a.screenFreeExtension))
      c.addIssue({ code: 'custom', message: 'Kids requires age guidance, materials, supervision, safety and screen-free extension' });
    if (a.contentType === 'activity' && (!a.materials?.length || !a.supervision || !a.safetyNotes?.length))
      c.addIssue({ code: 'custom', message: 'Activity requires materials and safety' });
  });

export const pushQuizSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    brand: brandSchema,
    passage: z.string().min(40).optional(),
    passageTitle: z.string().min(1).optional(),
    setId: z.string().regex(/^[a-z0-9-]+$/).optional(),
    hero: mediaSchema.optional(),
    prompt: z.string().min(10),
    options: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })).length(4),
    correctOptionId: z.string(),
    explanation: z.string().min(20),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    sources: z.array(sourceSchema).min(1, 'at least one source is required').max(10),
    // The Kids five fields: optional in shape, required by the refine below whenever brand is 'kids'.
    ageGuidance: z.string().optional(),
    materials: z.array(z.string()).optional(),
    supervision: z.string().optional(),
    safetyNotes: z.array(z.string()).optional(),
    screenFreeExtension: z.string().optional(),
  })
  .superRefine((q, c) => {
    if (new Set(q.options.map((o) => o.id)).size !== 4 || new Set(q.options.map((o) => o.text.trim().toLowerCase())).size !== 4)
      c.addIssue({ code: 'custom', message: 'Four distinct option IDs and texts required' });
    if (!q.options.some((o) => o.id === q.correctOptionId)) c.addIssue({ code: 'custom', message: 'Correct option must exist' });
    if (q.brand === 'kids' && (!q.ageGuidance || !q.materials?.length || !q.supervision || !q.safetyNotes?.length || !q.screenFreeExtension))
      c.addIssue({ code: 'custom', message: 'Kids requires age guidance, materials, supervision, safety and screen-free extension' });
  });

// The video component's metadata, as the agent states it. `brand` names the channel the video is INTENDED
// for; the site's YouTube integration holds one connected channel (SparkKindly), so the value is recorded
// on the push_videos row and reported back, and a 'mylux' video uploads to the connected channel until a
// second channel connection exists — the spec says this plainly rather than pretending otherwise.
export const pushVideoSchema = z.object({
  sourceUrl: z
    .url()
    .startsWith('https://')
    .optional(),
  title: z.string().min(1).max(100), // YouTube's own title limit
  description: z.string().max(5000).default(''),
  brand: z.enum(['sparkkindly', 'mylux']).default('sparkkindly'),
  tags: z.array(z.string().min(1).max(100)).max(15).default([]),
  madeForKids: z.boolean().default(false),
});

export const pushPackageSchema = z
  .object({
    article: pushArticleSchema.optional(),
    quizzes: z.array(pushQuizSchema).max(20).optional(),
    video: pushVideoSchema.optional(),
  })
  .superRefine((p, c) => {
    if (!p.article && !p.quizzes?.length)
      c.addIssue({ code: 'custom', message: 'A package needs an article or at least one quiz' });
    if (p.video && !p.article)
      c.addIssue({ code: 'custom', message: 'A video component rides on the package article in v1: include the article it belongs to' });
    // Slugs are the library's addresses: a package may not repeat one internally (a quiz id IS its slug).
    const slugs = [...(p.article ? [p.article.slug] : []), ...(p.quizzes ?? []).map((q) => q.id)];
    if (new Set(slugs).size !== slugs.length)
      c.addIssue({ code: 'custom', message: 'A package cannot contain the same slug twice' });
  });

export type PushArticle = z.infer<typeof pushArticleSchema>;
export type PushQuiz = z.infer<typeof pushQuizSchema>;
export type PushVideo = z.infer<typeof pushVideoSchema>;
export type PushPackage = z.infer<typeof pushPackageSchema>;

export const reviewDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().min(1).max(500).optional(),
  sourcesChecked: z.array(z.url().startsWith('https://')).max(10).optional(),
  solvedAnswer: z.string().max(200).optional(),
});
