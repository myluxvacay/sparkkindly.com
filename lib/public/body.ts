import { z } from 'zod';

// Item bodies come from the database as untrusted JSON (agents wrote them, the legacy import added fields). These
// readers never throw: a field of the wrong type is dropped, so one bad value cannot take a page down.
const opt = <T extends z.ZodType>(t: T) => t.optional().catch(undefined);
const text = z.string();
const list = z.array(z.string());
const choice = z.object({ id: z.string(), text: z.string() });

const articleBody = z.object({
  sections: z.array(z.object({ heading: text, paragraphs: list })).catch([]),
  takeaway: z.string().catch(''),
  fiction: opt(z.boolean()),
  byline: opt(text),
  aiDisclosure: opt(text),
  ageGuidance: opt(text),
  materials: opt(list),
  supervision: opt(text),
  safetyNotes: opt(list),
  screenFreeExtension: opt(text),
  correctionNote: opt(text),
  productionStatus: opt(text),
  videoSrc: opt(text),
  captionsSrc: opt(text),
  transcript: opt(text),
});
export type ArticleView = z.infer<typeof articleBody>;

const playBody = z.object({
  mechanic: opt(text),
  prompt: z.string().catch(''),
  options: z.array(choice).catch([]),
  items: z.array(choice).catch([]),
  clues: list.catch([]),
});
export type PlayView = z.infer<typeof playBody>;

const image = z.object({ src: opt(text), alt: z.string().catch(''), width: opt(z.number()), height: opt(z.number()), credit: opt(text), rights: opt(text) });
export type ImageView = z.infer<typeof image>;

const record = (x: unknown): object => (typeof x === 'object' && x !== null && !Array.isArray(x) ? x : {});

export const readArticle = (body: unknown): ArticleView => articleBody.parse(record(body));
export const readPlay = (body: unknown): PlayView => playBody.parse(record(body));
export const readImage = (raw: unknown): ImageView => image.parse(record(raw));
