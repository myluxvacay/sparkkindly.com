import { z } from 'zod';
import { SCENE_ART_KEYS, SCENE_COLORS, SCENE_TEMPLATES, type SceneSpec } from '@/lib/games/scene';

// Item bodies come from the database as untrusted JSON (agents wrote them, the legacy import added fields). These
// readers never throw: a field of the wrong type is dropped, so one bad value cannot take a page down.
const opt = <T extends z.ZodType>(t: T) => t.optional().catch(undefined);
const text = z.string();
const list = z.array(z.string());
const choice = z.object({ id: z.string(), text: z.string(), art: opt(text), alt: opt(text), color: opt(z.enum(SCENE_COLORS)) });

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
const matchPieceView = z.object({ id: text, text: text, art: opt(text), alt: opt(text), value: opt(z.number()) });
const matchTargetView = z.object({ id: text, text: text, art: opt(text), alt: opt(text), dots: opt(z.number()) });
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
  // Wave 1 (21 Nov 2026): the five new types' payloads, read as defensively as everything above.
  // ANSWER-KEY FIELDS ARE DELIBERATELY ABSENT: statementIsFact (fact-or-fiction), feeling
  // (emotion-detectives) and decoyLetter (build-a-word) would hand the player the answer in the
  // page payload — the stored body carries them, this reader strips them (review finding H1,
  // 21 Nov 2026). No component reads them; the verdict comes from the server-side answer key.
  match: opt(z.object({ variant: opt(text), pieces: z.array(matchPieceView).catch([]), targets: z.array(matchTargetView).catch([]) })),
  statement: opt(text),
  scenario: opt(text),
  missingPosition: opt(z.number()),
  tiles: opt(z.array(text)),
});
export type VisualView = z.infer<typeof visual>;

/** The renderer's typed scene spec, or null when the stored scene cannot be drawn safely. */
export function toSceneSpec(view: SceneView | undefined): SceneSpec | null {
  if (!view || !(SCENE_TEMPLATES as readonly string[]).includes(view.template)) return null;
  const elements = view.elements.filter((el) => (SCENE_ART_KEYS as readonly string[]).includes(el.art));
  if (elements.length !== view.elements.length) return null;
  return { template: view.template as SceneSpec['template'], clockTime: view.clockTime, signText: view.signText, elements };
}

// A section may carry one wide illustration (the step strip on "How it works" sections,
// 21 Nov 2026) plus, optionally, that strip's panel set (imagePanels — the mobile 2x2
// arrangement of the same illustration): the same defensive shape as the hero image view below.
const sectionImage = z.object({ src: opt(text), alt: z.string().catch(''), width: opt(z.number()), height: opt(z.number()), credit: opt(text), rights: opt(text) });
export type SectionImageView = z.infer<typeof sectionImage>;

const articleBody = z.object({
  sections: z.array(z.object({ heading: text, paragraphs: list, image: opt(sectionImage), imagePanels: opt(z.array(sectionImage)) })).catch([]),
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
  passageImage: opt(z.object({ src: opt(text), alt: z.string().catch('') })),
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
