import { z } from 'zod';
import { dateSchema } from '@/lib/schemas';

export const mechanics = [
  'multiple_choice',
  'true_false',
  'short_text',
  'number',
  'odd_one_out',
  'put_in_order',
  'clue_reveal',
] as const;
export type Mechanic = (typeof mechanics)[number];

// Kinds an agent may submit today. `puzzle` is reserved for later screen-based mechanics, added one at a time.
export const supportedKinds = ['article', 'game', 'quiz', 'video_script'] as const;

const slug = z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and hyphens only');
const source = z.object({ title: z.string().min(1), url: z.url().startsWith('https://'), accessedAt: dateSchema });
const choice = z.object({ id: z.string().min(1), text: z.string().min(1) });

const common = {
  world: slug.optional(), // the master agent names the world; a world agent may only use its own
  slug: slug.min(3).max(80),
  title: z.string().min(3).max(140),
  summary: z.string().min(10).max(300),
  audience: z.enum(['kids', 'all', 'adults']),
  evergreen: z.boolean().default(false),
  topics: z.array(slug).max(8).default([]),
  sources: z.array(source).default([]),
  image: z
    .object({
      origin: z.enum(['template', 'stock', 'generated', 'owner-supplied']),
      licence: z.string().min(1),
      src: z.string().optional(),
      alt: z.string(),
    })
    .optional(),
  publishAt: z.iso.datetime().optional(),
  idempotencyKey: z.string().min(8).max(100),
};

const articleBody = z.object({
  sections: z.array(z.object({ heading: z.string().min(1), paragraphs: z.array(z.string().min(1)).min(1) })).min(2),
  takeaway: z.string().min(1),
  fiction: z.boolean().optional(),
  // Kids activity fields: kept so the Kids world can show age guidance, materials and safety.
  ageGuidance: z.string().optional(),
  materials: z.array(z.string()).optional(),
  supervision: z.string().optional(),
  safetyNotes: z.array(z.string()).optional(),
  screenFreeExtension: z.string().optional(),
});

const playBody = z.object({
  mechanic: z.enum(mechanics),
  prompt: z.string().min(10),
  options: z.array(choice).optional(),
  items: z.array(choice).optional(),
  clues: z.array(z.string().min(1)).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

// The correct answer travels beside the body, never inside it, and is stored apart from it.
const answer = z.object({ value: z.unknown(), explanation: z.string().min(20) });

const videoBody = z.object({
  hook: z.string().min(1),
  beats: z.array(z.object({ voiceover: z.string().min(1), onScreenText: z.string(), visual: z.string().min(1) })).min(3),
  captions: z.string().min(1),
  hashtags: z.array(z.string()).max(15).default([]),
});

type PlayCandidate = { body: z.infer<typeof playBody>; answer: { value: unknown } };

function checkPlay(v: PlayCandidate, ctx: z.RefinementCtx) {
  const { mechanic, options, items, clues } = v.body;
  const a = v.answer.value;
  const bad = (message: string, path: (string | number)[] = ['answer', 'value']) => ctx.addIssue({ code: 'custom', message, path });
  const distinct = (list: { id: string; text: string }[]) =>
    new Set(list.map((o) => o.id)).size === list.length && new Set(list.map((o) => o.text.trim().toLowerCase())).size === list.length;
  const isAccepted = (x: unknown) =>
    typeof x === 'object' && x !== null && Array.isArray((x as { accepted?: unknown }).accepted) &&
    (x as { accepted: unknown[] }).accepted.length > 0 && (x as { accepted: unknown[] }).accepted.every((s) => typeof s === 'string' && s.length > 0);

  switch (mechanic) {
    case 'multiple_choice':
      if (!options || options.length !== 4 || !distinct(options)) return bad('multiple_choice needs exactly four distinct options', ['body', 'options']);
      if (typeof a !== 'string' || !options.some((o) => o.id === a)) bad('answer must be the id of one of the options');
      return;
    case 'true_false':
      if (typeof a !== 'boolean') bad('answer must be true or false');
      return;
    case 'short_text':
      if (!isAccepted(a)) bad('answer must be { accepted: [one or more strings] }');
      return;
    case 'number':
      if (typeof a !== 'object' || a === null || typeof (a as { value?: unknown }).value !== 'number' ||
          typeof (a as { tolerance?: unknown }).tolerance !== 'number' || (a as { tolerance: number }).tolerance < 0) {
        bad('answer must be { value: number, tolerance: number >= 0 }');
      }
      return;
    case 'odd_one_out':
      if (!items || items.length !== 4 || !distinct(items)) return bad('odd_one_out needs exactly four distinct items', ['body', 'items']);
      if (typeof a !== 'string' || !items.some((o) => o.id === a)) bad('answer must be the id of one of the items');
      return;
    case 'put_in_order': {
      if (!items || items.length < 3 || items.length > 6 || !distinct(items)) return bad('put_in_order needs three to six distinct items', ['body', 'items']);
      const ids = items.map((o) => o.id).sort().join('|');
      if (!Array.isArray(a) || a.length !== items.length || a.map(String).sort().join('|') !== ids) bad('answer must be every item id exactly once, in order');
      return;
    }
    case 'clue_reveal':
      if (!clues || clues.length < 3 || clues.length > 6) return bad('clue_reveal needs three to six clues', ['body', 'clues']);
      if (!isAccepted(a)) bad('answer must be { accepted: [one or more strings] }');
      return;
  }
}

export const itemSubmissionSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('article'), body: articleBody }),
  z.object({ ...common, kind: z.literal('quiz'), body: playBody, answer }).superRefine(checkPlay),
  z.object({ ...common, kind: z.literal('game'), body: playBody, answer }).superRefine(checkPlay),
  z.object({ ...common, kind: z.literal('video_script'), body: videoBody }),
]);

export type ItemSubmission = z.infer<typeof itemSubmissionSchema>;

// Splits a validated submission into what is stored on the item and what goes to item_answers.
// Unknown keys were already stripped by validation, so an answer smuggled into the body is gone.
export function splitAnswer(sub: ItemSubmission): { body: unknown; answer: { value: unknown; explanation: string } | null } {
  if (sub.kind === 'quiz' || sub.kind === 'game') return { body: sub.body, answer: sub.answer };
  return { body: sub.body, answer: null };
}
