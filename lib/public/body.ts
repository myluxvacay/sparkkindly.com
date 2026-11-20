import { z } from 'zod';
import { SCENE_ART_KEYS, SCENE_COLORS, SCENE_TEMPLATES, type SceneSpec } from '@/lib/games/scene';

// Item bodies come from the database as untrusted JSON (agents wrote them, the legacy import added fields). These
// readers never throw: a field of the wrong type is dropped, so one bad value cannot take a page down.
const opt = <T extends z.ZodType>(t: T) => t.optional().catch(undefined);
const text = z.string();
const list = z.array(z.string());
const choice = z.object({ id: z.string(), text: z.string(), art: opt(text), alt: opt(text) });

// Visual game payload (18 Nov 2026): the scene data a picture game renders from. Read as defensively
// as everything else here; toSceneSpec below turns it into the renderer's typed spec or drops it.
const sceneElementView = z.object({
  id: text,
  art: text,
  name: text,
  color: opt(z.enum(SCENE_COLORS)),
  x: z.number(),
  y: z.number(),
  scale: opt(z.number()),
  flip: opt(z.boolean()),
});
const sceneView = z.object({
  template: text,
  clockTime: opt(text),
  signText: opt(text),
  elements: z.array(sceneElementView).catch([]),
});
export type SceneView = z.infer<typeof sceneView>;
const visual = z.object({
  gameType: opt(text),
  scene: opt(sceneView),
  sceneAlt: opt(text),
  sceneAfter: opt(sceneView),
  sceneAfterAlt: opt(text),
  sequence: z.array(z.object({ art: text, label: text, color: opt(z.enum(SCENE_COLORS)) })).catch([]),
  askPosition: opt(z.number()),
  decoyLabel: opt(text),
  heroArt: opt(text),
  heroAlt: opt(text),
});
export type VisualView = z.infer<typeof visual>;

/** The renderer's typed scene spec, or null when the stored scene cannot be drawn safely. */
export function toSceneSpec(view: SceneView | undefined): SceneSpec | null {
  if (!view || !(SCENE_TEMPLATES as readonly string[]).includes(view.template)) return null;
  const elements = view.elements.filter((el) => (SCENE_ART_KEYS as readonly string[]).includes(el.art));
  if (elements.length !== view.elements.length) return null;
  return { template: view.template as SceneSpec['template'], clockTime: view.clockTime, signText: view.signText, elements };
}

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
  passage: opt(text),
  passageTitle: opt(text),
  setId: opt(text),
  prompt: z.string().catch(''),
  options: z.array(choice).catch([]),
  items: z.array(choice).catch([]),
  clues: list.catch([]),
  difficulty: opt(z.enum(['easy', 'medium', 'hard'])),
  visual: opt(visual),
});
export type PlayView = z.infer<typeof playBody>;
export type Difficulty = NonNullable<PlayView['difficulty']>;

const image = z.object({ src: opt(text), alt: z.string().catch(''), width: opt(z.number()), height: opt(z.number()), credit: opt(text), rights: opt(text) });
export type ImageView = z.infer<typeof image>;

const record = (x: unknown): object => (typeof x === 'object' && x !== null && !Array.isArray(x) ? x : {});

export const readArticle = (body: unknown): ArticleView => articleBody.parse(record(body));
export const readPlay = (body: unknown): PlayView => playBody.parse(record(body));
export const readImage = (raw: unknown): ImageView => image.parse(record(raw));
