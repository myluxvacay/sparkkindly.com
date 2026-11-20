import { z } from 'zod';
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Invalid calendar date');
export const brandSchema = z.enum(['play','discover','together','grow','save','kids']);
const sourceSchema = z.object({title:z.string().min(1),url:z.url().startsWith('https://'),accessedAt:dateSchema});
const review = { reviewStatus:z.enum(['draft','source-check','safety-review','approved']), reviewer:z.string().nullable(), reviewedAt:dateSchema.nullable(), reviewNote:z.string().optional() };
const media = z.object({src:z.string().startsWith('/images/'),alt:z.string(),width:z.number().positive(),height:z.number().positive(),credit:z.string().min(1),rights:z.string().min(1)});
export const articleSchema = z.object({id:z.string().min(1),slug:z.string().regex(/^[a-z0-9-]+$/),brand:brandSchema,contentType:z.enum(['article','video','activity']),title:z.string().min(1),description:z.string().min(1),publishedAt:dateSchema.nullable(),updatedAt:dateSchema,author:z.string().min(1),...review,ageGuidance:z.string().optional(),hero:media,tags:z.array(z.string()),sources:z.array(sourceSchema),factualClaimsReviewedAt:dateSchema.nullable(),aiDisclosure:z.string().min(1),body:z.array(z.object({heading:z.string().min(1),paragraphs:z.array(z.string().min(1)).min(1)})).min(2),takeaway:z.string().min(1),fiction:z.boolean().default(false),correctionNote:z.string().optional(),materials:z.array(z.string()).optional(),supervision:z.string().optional(),safetyNotes:z.array(z.string()).optional(),screenFreeExtension:z.string().optional(),productionStatus:z.enum(['in-production','available']).optional(),durationSeconds:z.number().positive().nullable().optional(),poster:media.optional(),videoSrc:z.string().nullable().optional(),captionsSrc:z.string().nullable().optional(),transcript:z.string().optional()}).superRefine((a,c)=>{
 if(a.reviewStatus==='approved' && (!a.reviewer || !a.reviewedAt || !a.publishedAt || !a.factualClaimsReviewedAt)) c.addIssue({code:'custom',message:'Approval requires actual reviewer, review dates and publication date'});
 if(a.brand==='kids' && (!a.ageGuidance || !a.materials?.length || !a.supervision || !a.safetyNotes?.length || !a.screenFreeExtension)) c.addIssue({code:'custom',message:'Kids requires age guidance, materials, supervision, safety and screen-free extension'});
 if(a.contentType==='activity' && (!a.materials?.length || !a.supervision || !a.safetyNotes?.length)) c.addIssue({code:'custom',message:'Activity requires materials and safety'});
 if(a.contentType==='video' && (!a.poster || !a.transcript || !a.productionStatus)) c.addIssue({code:'custom',message:'Video requires production status, poster and descriptive transcript'});
 if(a.productionStatus==='available' && (!a.videoSrc || !a.captionsSrc || !a.durationSeconds)) c.addIssue({code:'custom',message:'Available video requires media, captions and duration'});
});
export const quizSchema = z.object({id:z.string().regex(/^[a-z0-9-]+$/),scheduledDate:dateSchema,brand:brandSchema,
 // Reading strand (20 Nov 2026): a passage set question carries its passage with it so the text stays
 // on screen while the reader answers; setId groups the questions authored against one passage.
 passage:z.string().min(40).optional(),passageTitle:z.string().min(1).optional(),setId:z.string().regex(/^[a-z0-9-]+$/).optional(),
 prompt:z.string().min(10),options:z.array(z.object({id:z.string().min(1),text:z.string().min(1)})).length(4),correctOptionId:z.string(),explanation:z.string().min(20),difficulty:z.enum(['easy','medium','hard']),sources:z.array(sourceSchema),...review}).superRefine((q,c)=>{
 if(new Set(q.options.map(o=>o.id)).size!==4 || new Set(q.options.map(o=>o.text.trim().toLowerCase())).size!==4) c.addIssue({code:'custom',message:'Four distinct option IDs and texts required'});
 if(!q.options.some(o=>o.id===q.correctOptionId)) c.addIssue({code:'custom',message:'Correct option must exist'});
 if(q.reviewStatus==='approved' && (!q.reviewer || !q.reviewedAt)) c.addIssue({code:'custom',message:'Human approval requires actual review identity and date'});
});
import {
  GAME_TYPES,
  SCENE_ART_KEYS,
  SCENE_COLORS,
  SCENE_TEMPLATES,
  countInScene,
  describeChanges,
  diffScenes,
  elementLabel,
  factValue,
  sameText,
  splitLabel,
  templateCollisions,
  type SceneSpec,
} from './games/scene';

const sceneElementSchema = z.object({
  id: z.string().min(1),
  art: z.enum(SCENE_ART_KEYS),
  name: z.string().min(1),
  color: z.enum(SCENE_COLORS).optional(),
  x: z.number().min(30).max(770),
  y: z.number().min(60).max(520),
  scale: z.number().min(0.4).max(2.5).optional(),
  flip: z.boolean().optional(),
});
export const sceneSpecSchema = z.object({
  template: z.enum(SCENE_TEMPLATES),
  clockTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  signText: z.string().min(1).max(24).optional(),
  elements: z.array(sceneElementSchema).max(24),
});
const sceneFactSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('clock') }),
  z.object({ type: z.literal('sign') }),
  z.object({ type: z.literal('color'), elementId: z.string().min(1) }),
  z.object({ type: z.literal('count'), art: z.enum(SCENE_ART_KEYS), color: z.enum(SCENE_COLORS).optional() }),
  z.object({ type: z.literal('present'), elementId: z.string().min(1) }),
  z.object({ type: z.literal('absent'), label: z.string().min(1) }),
]);
const visualBlockSchema = z.object({
  gameType: z.enum(GAME_TYPES),
  scene: sceneSpecSchema.optional(),
  sceneAlt: z.string().min(10).optional(),
  sceneAfter: sceneSpecSchema.optional(),
  sceneAfterAlt: z.string().min(10).optional(),
  sequence: z.array(z.object({ art: z.enum(SCENE_ART_KEYS), label: z.string().min(1), color: z.enum(SCENE_COLORS).optional() })).min(3).max(5).optional(),
  askPosition: z.number().int().min(1).max(5).optional(),
  decoyLabel: z.string().min(1).optional(),
  heroArt: z.string().min(1).optional(),
  heroAlt: z.string().min(1).optional(),
  fact: sceneFactSchema.optional(),
  countTarget: z.object({ art: z.enum(SCENE_ART_KEYS), color: z.enum(SCENE_COLORS).optional() }).optional(),
  expectedChanges: z.array(z.string()).optional(),
});
const gameChoice = z.object({ id: z.string().min(1), text: z.string().min(1), art: z.string().min(1).optional(), alt: z.string().optional() });

// Visual games (owner direction, 18 Nov 2026): picture rounds as first-class library content, in the
// same pipeline as quizzes. The superRefine PROVES each answer against the scene data — counts are
// recounted, scene pairs are re-diffed, facts are re-read — so a generated game with a wrong key
// cannot pass content:validate. Scene-carrying rounds use text-only options on purpose: an option
// must never repeat the scene's picture (owner rule from the 17 Nov 2026 flags round).
export const gameSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  scheduledDate: dateSchema,
  brand: brandSchema,
  gameType: z.enum(GAME_TYPES),
  title: z.string().min(3),
  prompt: z.string().min(10),
  options: z.array(gameChoice).optional(),
  items: z.array(gameChoice).optional(),
  correctOptionId: z.string().optional(),
  numberAnswer: z.object({ value: z.number().int().min(0), tolerance: z.literal(0) }).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  explanation: z.string().min(20),
  sources: z.array(sourceSchema),
  visual: visualBlockSchema,
  ...review,
}).superRefine((g, c) => {
  const bad = (message: string) => c.addIssue({ code: 'custom', message });
  if (g.visual.gameType !== g.gameType) bad('visual.gameType must match gameType');
  if (g.reviewStatus === 'approved' && (!g.reviewer || !g.reviewedAt)) bad('Approval requires actual reviewer and review date');

  const checkChoices = (list: { id: string; text: string; art?: string }[] | undefined, what: string) => {
    if (!list || list.length !== 4) return bad(`${what} needs exactly four entries`);
    if (new Set(list.map((o) => o.id)).size !== 4 || new Set(list.map((o) => o.text.trim().toLowerCase())).size !== 4)
      return bad(`${what} needs four distinct ids and texts`);
    if (!g.correctOptionId || !list.some((o) => o.id === g.correctOptionId)) bad('Correct option must exist');
  };
  const correctText = (list: { id: string; text: string }[]) => list.find((o) => o.id === g.correctOptionId)?.text;
  const sceneOf = (s: SceneSpec | undefined, what: string) => {
    if (!s) return bad(`${what} is required`);
    if (new Set(s.elements.map((e) => e.id)).size !== s.elements.length) bad(`${what} has duplicate element ids`);
    return s;
  };

  switch (g.gameType) {
    case 'observation':
    case 'memory': {
      const scene = sceneOf(g.visual.scene, 'scene');
      checkChoices(g.options, 'options');
      if (g.options?.some((o) => o.art)) bad('Scene game options are text-only (an option must never repeat the scene)');
      if (!g.visual.fact) bad('An observation/memory game needs a fact');
      else if (scene && g.options) {
        const value = factValue(scene, g.visual.fact);
        if (value === null) bad('The scene cannot answer the stored fact');
        else {
          const text = correctText(g.options);
          if (!text || !sameText(text, value)) bad(`Correct option must be the fact value "${value}"`);
        }
        // A colour question names only the object ("what colour is the duck?"), so it is only
        // answerable when every scene element of that kind shares the one colour — two ducks of
        // different colours make the marked answer arbitrary (independent review, 18 Nov 2026).
        if (g.visual.fact.type === 'color') {
          const target = scene.elements.find((e) => e.id === (g.visual.fact as { elementId?: string }).elementId);
          if (target && scene.elements.some((e) => e.art === target.art && e.color !== target.color)) {
            bad('Colour question is ambiguous: the scene holds that object in more than one colour');
          }
        }
        // Backdrop collisions (owner report, 18 Nov 2026): facts are proven from element data,
        // but the player answers from the whole rendered picture, backdrop included — the farm
        // backdrop draws a big red barn, so observation-030's small "yellow house" element answer
        // read as wrong. A fact may not hinge on a category the backdrop also draws in another
        // colour or form, and no decoy option may name something the backdrop itself shows.
        if (scene && g.options && g.visual.fact) {
          const fact = g.visual.fact;
          const elLabels = new Set(scene.elements.map((e) => elementLabel(e).toLowerCase()));
          const wrongs = g.options.filter((o) => o.id !== g.correctOptionId);
          const backdropShows = (text: string): boolean => {
            const { color, noun } = splitLabel(text);
            const hits = templateCollisions(scene.template, noun);
            return hits.length > 0 && (!color || hits.some((h) => h.colors.length === 0 || h.colors.includes(color)));
          };
          if (fact.type === 'present') {
            const target = scene.elements.find((e) => e.id === fact.elementId);
            if (target?.color) {
              const hits = templateCollisions(scene.template, target.name.toLowerCase());
              if (hits.length && !hits.some((h) => h.colors.includes(target.color!))) {
                bad(`Present fact is ambiguous: the ${scene.template} backdrop also draws a ${hits[0].colors.join('/')} ${target.name} (${hits[0].note})`);
              }
            }
            for (const o of wrongs) {
              if (backdropShows(o.text)) bad(`Option "${o.text}" is visible in the ${scene.template} backdrop itself`);
              if (elLabels.has(o.text.trim().toLowerCase())) bad(`Option "${o.text}" names another element in the scene`);
            }
          } else if (fact.type === 'absent') {
            if (templateCollisions(scene.template, splitLabel(fact.label).noun).length) {
              bad(`Absent fact is ambiguous: the ${scene.template} backdrop draws a ${splitLabel(fact.label).noun} itself`);
            }
            for (const o of wrongs) {
              if (!elLabels.has(o.text.trim().toLowerCase()) && !backdropShows(o.text)) {
                bad(`Option "${o.text}" is not in the picture either — an absent question needs exactly one absent option`);
              }
            }
          } else if (fact.type === 'color') {
            const target = scene.elements.find((e) => e.id === fact.elementId);
            if (target && templateCollisions(scene.template, target.name.toLowerCase()).length) {
              bad(`Colour fact is ambiguous: the ${scene.template} backdrop also draws a ${target.name}`);
            }
          } else if (fact.type === 'count') {
            const named = scene.elements.find((e) => e.art === fact.art);
            if (named && templateCollisions(scene.template, named.name.toLowerCase()).length) {
              bad(`Count fact is ambiguous: the ${scene.template} backdrop also draws ${named.name}s`);
            }
          }
        }
      }
      break;
    }
    case 'spot-difference':
    case 'what-changed': {
      const before = sceneOf(g.visual.scene, 'scene');
      const after = sceneOf(g.visual.sceneAfter, 'sceneAfter');
      checkChoices(g.options, 'options');
      if (g.options?.some((o) => o.art)) bad('Scene game options are text-only (an option must never repeat the scene)');
      if (before && after && g.options) {
        const changes = diffScenes(before, after);
        const want = g.gameType === 'spot-difference' ? 3 : 1;
        if (changes.length !== want) bad(`${g.gameType} needs exactly ${want} change(s); the scenes differ in ${changes.length}`);
        const keys = changes.map((ch) => ch.key).sort();
        if (JSON.stringify([...(g.visual.expectedChanges ?? [])].sort()) !== JSON.stringify(keys))
          bad('expectedChanges must equal the recomputed scene diff');
        const text = correctText(g.options);
        if (!text || !sameText(text, describeChanges(changes))) bad('Correct option must be the canonical description of the change(s)');
      }
      break;
    }
    case 'counting': {
      const scene = sceneOf(g.visual.scene, 'scene');
      if (!g.visual.countTarget) bad('A counting game needs a countTarget');
      if (!g.numberAnswer) bad('A counting game needs a numberAnswer');
      if (scene && g.visual.countTarget && g.numberAnswer) {
        const n = countInScene(scene, g.visual.countTarget);
        if (n !== g.numberAnswer.value) bad(`Counted ${n} in the scene, but the stored answer is ${g.numberAnswer.value}`);
        if (n < 1) bad('A counting game must count at least one thing');
        // The backdrop counts too (owner report, 18 Nov 2026): the space backdrop is full of
        // small stars and stands on a planet, the street backdrop is three houses — a target the
        // backdrop also draws can never be counted exactly from the picture.
        const target = g.visual.countTarget;
        const named = scene.elements.find((e) => e.art === target.art);
        if (named && templateCollisions(scene.template, named.name.toLowerCase()).length) {
          bad(`Counting target is ambiguous: the ${scene.template} backdrop also draws ${named.name}s`);
        }
      }
      break;
    }
    case 'sequence': {
      const seq = g.visual.sequence;
      if (!seq || seq.length < 3 || seq.length > 5) bad('A sequence game needs 3 to 5 sequence entries');
      checkChoices(g.options, 'options');
      if (g.options?.some((o) => o.art)) bad('Sequence options are text-only (the strip already shows the pictures)');
      if (seq && g.options && g.visual.askPosition) {
        const pos = g.visual.askPosition;
        if (pos < 1 || pos > seq.length) bad('askPosition is outside the sequence');
        else {
          const want = seq[pos - 1].label;
          const text = correctText(g.options);
          if (!text || !sameText(text, want)) bad(`Correct option must be the item at position ${pos} ("${want}")`);
          const labels = new Set(seq.map((s) => s.label.toLowerCase()));
          const outside = g.options.filter((o) => !labels.has(o.text.trim().toLowerCase()));
          if (outside.length > 1) bad('At most one option may sit outside the sequence (the declared decoy)');
          if (outside.length === 1 && (!g.visual.decoyLabel || !sameText(outside[0].text, g.visual.decoyLabel)))
            bad('The outside option must be the declared decoyLabel');
        }
      } else if (!g.visual.askPosition) bad('A sequence game needs askPosition');
      break;
    }
    case 'odd-one-out': {
      checkChoices(g.items, 'items');
      if (g.items?.some((o) => !o.art)) bad('Odd-one-out items all carry artwork');
      break;
    }
    case 'pick-the-right-one':
    case 'flags-and-places': {
      checkChoices(g.options, 'options');
      break;
    }
  }
  // The pinned hero rule (owner report, 17 Nov 2026): no option may repeat the hero picture.
  if (g.visual.heroArt) {
    const all = [...(g.options ?? []), ...(g.items ?? [])];
    if (all.some((o) => o.art === g.visual.heroArt)) bad('An option repeats the hero image');
  }
  // Scene alts are generated from the same data (describeScene in the generator); a stored alt that
  // names something absent would mislead a screen-reader player, so element labels must appear in it.
  for (const [scene, alt] of [[g.visual.scene, g.visual.sceneAlt], [g.visual.sceneAfter, g.visual.sceneAfterAlt]] as const) {
    if (scene && alt) {
      for (const el of scene.elements) {
        if (!alt.toLowerCase().includes(elementLabel(el).toLowerCase()))
          bad(`Scene alt text does not mention "${elementLabel(el)}"`);
      }
    }
  }
});
export type Game = z.infer<typeof gameSchema>;

export type Article = z.infer<typeof articleSchema>;
export type Quiz = z.infer<typeof quizSchema>;
export function assertUnique(items: {id:string;scheduledDate?:string;slug?:string;brand?:string}[]) {
 for(const key of ['id','scheduledDate','route'] as const) {
 const values = items.map(i=>key==='route' ? (i.slug ? `${i.brand}/${i.slug}` : undefined) : i[key]).filter(Boolean);
 if(new Set(values).size!==values.length) throw new Error(`Duplicate ${key}`);
 }
}
