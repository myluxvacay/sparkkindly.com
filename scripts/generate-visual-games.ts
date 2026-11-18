// Generates the visual games collection (owner direction, 18 Nov 2026) into content/games/.
//
// Every game is built from a parametric scene (lib/games/scene.ts) and its answer is DERIVED with
// the same pure functions the content schema uses to prove it — the generator parses each game
// through gameSchema before writing, so a file that reaches disk already passes the proof checks.
// Review state starts at 'safety-review' with no reviewer: the independent review pass flips
// approved games via scripts/approve-visual-games.ts, which also writes the registry entries.
//
// Deterministic: a seeded RNG per game, so re-running reproduces the same collection byte for byte
// (existing files are left untouched unless --force is passed).
import fs from 'node:fs';
import path from 'node:path';
import {
  describeChanges,
  describeScene,
  diffScenes,
  elementLabel,

  type SceneColor,
  type SceneElement,
  type SceneSpec,
  type SceneTemplate,
} from '../lib/games/scene';
import { gameSchema } from '../lib/schemas';

const OUT = path.join(process.cwd(), 'content', 'games');
const FORCE = process.argv.includes('--force');
const TODAY = '2026-11-18';

// --- Seeded RNG (mulberry32) -------------------------------------------------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = ReturnType<typeof rng>;
const pick = <T,>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];
const shuffle = <T,>(r: Rng, list: T[]): T[] => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const sample = <T,>(r: Rng, list: readonly T[], n: number): T[] => shuffle(r, [...list]).slice(0, n);

// --- Element catalogue --------------------------------------------------------
type Zone = 'ground' | 'water' | 'sky' | 'counter';
type CatEntry = { art: string; name: string; zones: Zone[]; colors?: SceneColor[] };
const CATALOG: CatEntry[] = [
  { art: 'duck', name: 'duck', zones: ['water', 'ground'], colors: ['yellow', 'white', 'brown'] },
  { art: 'cat', name: 'cat', zones: ['ground', 'counter'], colors: ['orange', 'gray', 'black', 'white'] },
  { art: 'dog', name: 'dog', zones: ['ground'], colors: ['brown', 'black', 'white', 'gray'] },
  { art: 'bird', name: 'bird', zones: ['sky', 'ground'], colors: ['blue', 'red', 'yellow', 'green'] },
  { art: 'fish', name: 'fish', zones: ['water'], colors: ['orange', 'blue', 'purple', 'pink'] },
  { art: 'frog', name: 'frog', zones: ['water', 'ground'], colors: ['green'] },
  { art: 'butterfly', name: 'butterfly', zones: ['sky'], colors: ['purple', 'pink', 'blue', 'orange'] },
  { art: 'bee', name: 'bee', zones: ['sky'] },
  { art: 'ladybug', name: 'ladybug', zones: ['ground'], colors: ['red'] },
  { art: 'snail', name: 'snail', zones: ['ground'], colors: ['purple', 'brown'] },
  { art: 'turtle', name: 'turtle', zones: ['water', 'ground'], colors: ['green'] },
  { art: 'crab', name: 'crab', zones: ['water', 'ground'], colors: ['red', 'orange'] },
  { art: 'penguin', name: 'penguin', zones: ['ground'] },
  { art: 'owl', name: 'owl', zones: ['ground'], colors: ['brown', 'gray'] },
  { art: 'cow', name: 'cow', zones: ['ground'], colors: ['white', 'brown'] },
  { art: 'pig', name: 'pig', zones: ['ground'], colors: ['pink'] },
  { art: 'sheep', name: 'sheep', zones: ['ground'], colors: ['white', 'gray', 'black'] },
  { art: 'horse', name: 'horse', zones: ['ground'], colors: ['brown', 'black', 'white', 'gray'] },
  { art: 'chicken', name: 'chicken', zones: ['ground'], colors: ['white', 'brown'] },
  { art: 'rabbit', name: 'rabbit', zones: ['ground'], colors: ['gray', 'white', 'brown'] },
  { art: 'fox', name: 'fox', zones: ['ground'], colors: ['orange'] },
  { art: 'bear', name: 'bear', zones: ['ground'], colors: ['brown', 'black'] },
  { art: 'elephant', name: 'elephant', zones: ['ground'], colors: ['gray'] },
  { art: 'tree', name: 'tree', zones: ['ground'], colors: ['green', 'orange'] },
  { art: 'pine', name: 'pine tree', zones: ['ground'], colors: ['green'] },
  { art: 'flower', name: 'flower', zones: ['ground'], colors: ['pink', 'red', 'yellow', 'purple', 'white'] },
  { art: 'mushroom', name: 'mushroom', zones: ['ground'], colors: ['red', 'brown', 'purple'] },
  { art: 'star', name: 'star', zones: ['sky'], colors: ['yellow', 'white'] },
  { art: 'moon', name: 'moon', zones: ['sky'] },
  { art: 'cloud', name: 'cloud', zones: ['sky'], colors: ['white', 'gray'] },
  { art: 'balloon', name: 'balloon', zones: ['sky'], colors: ['red', 'blue', 'yellow', 'green', 'purple', 'pink'] },
  { art: 'kite', name: 'kite', zones: ['sky'], colors: ['red', 'blue', 'yellow', 'green', 'purple', 'pink'] },
  { art: 'ball', name: 'ball', zones: ['ground', 'counter'], colors: ['red', 'blue', 'yellow', 'green', 'purple'] },
  { art: 'book', name: 'book', zones: ['ground', 'counter'], colors: ['red', 'blue', 'green', 'purple'] },
  { art: 'apple', name: 'apple', zones: ['ground', 'counter'], colors: ['red', 'green', 'yellow'] },
  { art: 'banana', name: 'banana', zones: ['ground', 'counter'] },
  { art: 'orange', name: 'orange', zones: ['ground', 'counter'], colors: ['orange'] },
  { art: 'grapes', name: 'bunch of grapes', zones: ['ground', 'counter'], colors: ['purple', 'green'] },
  { art: 'carrot', name: 'carrot', zones: ['ground', 'counter'] },
  { art: 'cupcake', name: 'cupcake', zones: ['counter', 'ground'], colors: ['pink', 'blue', 'purple', 'white'] },
  { art: 'shell', name: 'shell', zones: ['ground'], colors: ['pink', 'white', 'orange'] },
  { art: 'boat', name: 'boat', zones: ['water'], colors: ['white', 'red', 'blue'] },
  { art: 'train', name: 'train', zones: ['ground'], colors: ['blue', 'red', 'green'] },
  { art: 'car', name: 'car', zones: ['ground'], colors: ['red', 'blue', 'yellow', 'green', 'purple'] },
  { art: 'rocket', name: 'rocket', zones: ['sky'], colors: ['white', 'red', 'blue'] },
  { art: 'planet', name: 'planet', zones: ['sky'], colors: ['purple', 'blue', 'pink'] },
  { art: 'house', name: 'house', zones: ['ground'], colors: ['yellow', 'blue', 'pink', 'white'] },
  { art: 'gift', name: 'gift box', zones: ['ground', 'counter'], colors: ['red', 'blue', 'yellow', 'green', 'purple', 'pink'] },
  { art: 'hat', name: 'hat', zones: ['ground', 'counter'], colors: ['red', 'blue', 'yellow', 'green', 'purple'] },
  { art: 'umbrella', name: 'umbrella', zones: ['ground'], colors: ['red', 'blue', 'yellow', 'green', 'purple'] },
  { art: 'snowman', name: 'snowman', zones: ['ground'] },
  { art: 'pumpkin', name: 'pumpkin', zones: ['ground'], colors: ['orange'] },
];
const byArt = (art: string): CatEntry => CATALOG.find((e) => e.art === art)!;

// --- Template slots ------------------------------------------------------------
type Slot = { x: number; y: number; zone: Zone };
const SLOTS: Record<SceneTemplate, Slot[]> = {
  pond: [
    { x: 130, y: 440, zone: 'water' }, { x: 260, y: 465, zone: 'water' }, { x: 390, y: 435, zone: 'water' },
    { x: 520, y: 470, zone: 'water' }, { x: 650, y: 440, zone: 'water' }, { x: 330, y: 495, zone: 'water' },
    { x: 590, y: 500, zone: 'water' }, { x: 180, y: 500, zone: 'water' },
    { x: 120, y: 348, zone: 'ground' }, { x: 680, y: 348, zone: 'ground' },
    { x: 180, y: 150, zone: 'sky' }, { x: 400, y: 110, zone: 'sky' }, { x: 610, y: 160, zone: 'sky' },
  ],
  meadow: [
    { x: 110, y: 470, zone: 'ground' }, { x: 240, y: 495, zone: 'ground' }, { x: 370, y: 460, zone: 'ground' },
    { x: 500, y: 495, zone: 'ground' }, { x: 630, y: 465, zone: 'ground' }, { x: 720, y: 500, zone: 'ground' },
    { x: 180, y: 430, zone: 'ground' }, { x: 560, y: 425, zone: 'ground' }, { x: 430, y: 505, zone: 'ground' },
    { x: 170, y: 140, zone: 'sky' }, { x: 420, y: 100, zone: 'sky' }, { x: 640, y: 150, zone: 'sky' },
  ],
  farm: [
    { x: 300, y: 470, zone: 'ground' }, { x: 430, y: 500, zone: 'ground' }, { x: 560, y: 465, zone: 'ground' },
    { x: 690, y: 500, zone: 'ground' }, { x: 240, y: 430, zone: 'ground' }, { x: 620, y: 425, zone: 'ground' },
    { x: 370, y: 505, zone: 'ground' }, { x: 730, y: 450, zone: 'ground' },
    { x: 330, y: 130, zone: 'sky' }, { x: 560, y: 100, zone: 'sky' }, { x: 700, y: 170, zone: 'sky' },
  ],
  station: [
    { x: 110, y: 390, zone: 'ground' }, { x: 250, y: 390, zone: 'ground' }, { x: 400, y: 390, zone: 'ground' },
    { x: 540, y: 390, zone: 'ground' }, { x: 690, y: 390, zone: 'ground' }, { x: 180, y: 505, zone: 'ground' },
    { x: 480, y: 505, zone: 'ground' }, { x: 640, y: 500, zone: 'ground' },
  ],
  market: [
    { x: 110, y: 402, zone: 'counter' }, { x: 250, y: 402, zone: 'counter' }, { x: 390, y: 402, zone: 'counter' },
    { x: 530, y: 402, zone: 'counter' }, { x: 670, y: 402, zone: 'counter' },
    { x: 150, y: 508, zone: 'ground' }, { x: 330, y: 508, zone: 'ground' }, { x: 520, y: 508, zone: 'ground' },
    { x: 690, y: 508, zone: 'ground' },
  ],
  kitchen: [
    { x: 330, y: 396, zone: 'counter' }, { x: 470, y: 396, zone: 'counter' }, { x: 610, y: 396, zone: 'counter' },
    { x: 700, y: 396, zone: 'counter' }, { x: 120, y: 508, zone: 'ground' }, { x: 300, y: 508, zone: 'ground' },
    { x: 520, y: 508, zone: 'ground' }, { x: 690, y: 508, zone: 'ground' },
  ],
  beach: [
    { x: 130, y: 330, zone: 'water' }, { x: 300, y: 345, zone: 'water' }, { x: 470, y: 325, zone: 'water' },
    { x: 640, y: 345, zone: 'water' },
    { x: 120, y: 480, zone: 'ground' }, { x: 270, y: 505, zone: 'ground' }, { x: 420, y: 475, zone: 'ground' },
    { x: 570, y: 505, zone: 'ground' }, { x: 710, y: 480, zone: 'ground' }, { x: 350, y: 440, zone: 'ground' },
    { x: 220, y: 130, zone: 'sky' }, { x: 520, y: 105, zone: 'sky' }, { x: 690, y: 160, zone: 'sky' },
  ],
  classroom: [
    { x: 120, y: 470, zone: 'ground' }, { x: 270, y: 500, zone: 'ground' }, { x: 420, y: 465, zone: 'ground' },
    { x: 570, y: 500, zone: 'ground' }, { x: 710, y: 470, zone: 'ground' }, { x: 200, y: 425, zone: 'ground' },
    { x: 640, y: 425, zone: 'ground' }, { x: 480, y: 505, zone: 'ground' },
  ],
  park: [
    { x: 110, y: 480, zone: 'ground' }, { x: 250, y: 505, zone: 'ground' }, { x: 560, y: 480, zone: 'ground' },
    { x: 700, y: 505, zone: 'ground' }, { x: 390, y: 495, zone: 'ground' }, { x: 640, y: 440, zone: 'ground' },
    { x: 160, y: 440, zone: 'ground' },
    { x: 200, y: 140, zone: 'sky' }, { x: 470, y: 105, zone: 'sky' }, { x: 660, y: 165, zone: 'sky' },
  ],
  space: [
    { x: 130, y: 200, zone: 'sky' }, { x: 300, y: 150, zone: 'sky' }, { x: 470, y: 210, zone: 'sky' },
    { x: 640, y: 160, zone: 'sky' }, { x: 210, y: 320, zone: 'sky' }, { x: 560, y: 330, zone: 'sky' },
    { x: 380, y: 300, zone: 'sky' },
    { x: 170, y: 480, zone: 'ground' }, { x: 400, y: 495, zone: 'ground' }, { x: 630, y: 480, zone: 'ground' },
  ],
  garden: [
    { x: 120, y: 425, zone: 'ground' }, { x: 260, y: 405, zone: 'ground' }, { x: 540, y: 405, zone: 'ground' },
    { x: 680, y: 425, zone: 'ground' }, { x: 130, y: 505, zone: 'ground' }, { x: 300, y: 510, zone: 'ground' },
    { x: 480, y: 505, zone: 'ground' }, { x: 650, y: 510, zone: 'ground' }, { x: 390, y: 430, zone: 'ground' },
    { x: 230, y: 135, zone: 'sky' }, { x: 520, y: 110, zone: 'sky' },
  ],
  street: [
    { x: 120, y: 385, zone: 'ground' }, { x: 300, y: 385, zone: 'ground' }, { x: 660, y: 385, zone: 'ground' },
    { x: 140, y: 490, zone: 'ground' }, { x: 330, y: 505, zone: 'ground' }, { x: 520, y: 490, zone: 'ground' },
    { x: 690, y: 505, zone: 'ground' }, { x: 430, y: 460, zone: 'ground' },
    { x: 240, y: 120, zone: 'sky' }, { x: 560, y: 95, zone: 'sky' },
  ],
};

const TEMPLATE_WORLD: Record<SceneTemplate, string> = {
  pond: 'discover', meadow: 'play', farm: 'play', station: 'discover', market: 'save',
  kitchen: 'together', beach: 'play', classroom: 'grow', park: 'together', space: 'discover',
  garden: 'grow', street: 'together',
};
const TEMPLATE_PLACE: Record<SceneTemplate, string> = {
  pond: 'pond', meadow: 'meadow', farm: 'farm', station: 'train station', market: 'market stall',
  kitchen: 'kitchen', beach: 'beach', classroom: 'classroom', park: 'park', space: 'space scene',
  garden: 'garden', street: 'street',
};
const CLOCK_TEMPLATES: SceneTemplate[] = ['station', 'classroom', 'kitchen', 'park'];
const SIGN_TEMPLATES: SceneTemplate[] = ['market', 'station', 'street', 'garden', 'beach'];
const SIGN_WORDS = ['Bakery', 'Flowers', 'Tickets', 'Books', 'Fruit', 'Cafe', 'Library', 'Museum', 'Harbour', 'Toys', 'Post', 'Farm Shop'];

// --- Scene building -------------------------------------------------------------
let elementSeq = 0;
function makeElement(r: Rng, entry: CatEntry, slot: Slot, colorOverride?: SceneColor): SceneElement {
  elementSeq += 1;
  const color = colorOverride ?? (entry.colors ? pick(r, entry.colors) : undefined);
  return {
    id: `${entry.art}-${elementSeq}`,
    art: entry.art,
    name: entry.name,
    ...(color ? { color } : {}),
    x: slot.x + Math.round((r() - 0.5) * 16),
    y: slot.y,
    ...(r() < 0.25 ? { flip: true } : {}),
  };
}

/** A scene with `count` elements spread over distinct slots, honouring zone affinities. */
function buildScene(r: Rng, template: SceneTemplate, count: number, opts: { arts?: string[] } = {}): SceneSpec {
  const slots = shuffle(r, SLOTS[template]);
  const elements: SceneElement[] = [];
  const used = new Set<string>();
  for (const slot of slots) {
    if (elements.length >= count) break;
    const pool = CATALOG.filter(
      (e) => e.zones.includes(slot.zone) && (!opts.arts || opts.arts.includes(e.art)),
    );
    if (!pool.length) continue;
    const entry = pick(r, pool);
    const el = makeElement(r, entry, slot);
    if (used.has(el.id)) continue;
    used.add(el.id);
    elements.push(el);
  }
  return { template, elements };
}

const withClock = (scene: SceneSpec, time: string): SceneSpec => ({ ...scene, clockTime: time });
const withSign = (scene: SceneSpec, word: string): SceneSpec => ({ ...scene, signText: word });

function clockTimeFor(r: Rng, difficulty: string): string {
  const hour = 1 + Math.floor(r() * 12);
  const minute = difficulty === 'easy' ? pick(r, [0, 30]) : difficulty === 'medium' ? pick(r, [0, 15, 30, 45]) : pick(r, [5, 10, 20, 25, 35, 40, 50, 55]);
  return `${hour}:${String(minute).padStart(2, '0')}`;
}
function wrongTimes(r: Rng, right: string): string[] {
  const [h, m] = right.split(':').map(Number);
  const fmt = (hh: number, mm: number) => `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')}`;
  const candidates = [fmt(h + 1, m), fmt(h - 1, m), fmt(h, (m + 30) % 60), fmt(m === 0 ? h : h + 2, m === 0 ? 30 : (m + 15) % 60), fmt(h, (m + 45) % 60)];
  return sample(r, [...new Set(candidates)].filter((t) => t !== right), 3);
}

// --- Game assembly ----------------------------------------------------------------
type GameDraft = Record<string, unknown>;
const LETTERS = ['a', 'b', 'c', 'd'];
function mcOptions(r: Rng, correct: string, wrongs: string[]): { options: { id: string; text: string }[]; correctOptionId: string } {
  const texts = shuffle(r, [correct, ...wrongs.slice(0, 3)]);
  const options = texts.map((text, i) => ({ id: LETTERS[i], text }));
  return { options, correctOptionId: options.find((o) => o.text === correct)!.id };
}

function baseGame(id: string, gameType: string, brand: string, difficulty: string, title: string, prompt: string, explanation: string) {
  return {
    id, scheduledDate: TODAY, brand, gameType, title, prompt, difficulty, explanation,
    sources: [], reviewStatus: 'safety-review', reviewer: null, reviewedAt: null,
    reviewNote: 'Generated visual game (18 Nov 2026): the answer is derived from the scene data and proven by the content schema. Awaiting the independent review pass.',
  };
}

const COLORS: SceneColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'white', 'black', 'gray'];
const colorName = (c: string) => c;

function colorDistractors(r: Rng, right: string): string[] {
  return sample(r, COLORS.filter((c) => c !== right), 3);
}

// --- Observation & memory ---------------------------------------------------------
type FactKind = 'clock' | 'sign' | 'color' | 'count' | 'present' | 'absent';

function factGame(r: Rng, kind: 'observation' | 'memory', difficulty: string, n: number, factKind: FactKind): GameDraft | null {
  const templates = Object.keys(SLOTS) as SceneTemplate[];
  let template = pick(r, templates);
  if (factKind === 'clock') template = pick(r, CLOCK_TEMPLATES);
  if (factKind === 'sign') template = pick(r, SIGN_TEMPLATES);
  const size = difficulty === 'easy' ? 5 + Math.floor(r() * 2) : difficulty === 'medium' ? 8 + Math.floor(r() * 3) : 11 + Math.floor(r() * 4);
  let scene = buildScene(r, template, size);
  const place = TEMPLATE_PLACE[template];
  const mem = kind === 'memory';
  const lead = mem ? 'From memory: ' : '';
  let fact: unknown; let prompt = ''; let correct = ''; let wrongs: string[] = []; let explanation = '';

  if (factKind === 'clock') {
    const time = clockTimeFor(r, difficulty);
    scene = withClock(scene, time);
    fact = { type: 'clock' };
    prompt = `${lead}what time does the clock in the ${place} show?`;
    correct = time;
    wrongs = wrongTimes(r, time);
    const [h, m] = time.split(':').map(Number);
    explanation = `The clock's short hand points ${m >= 30 ? 'past' : 'towards'} ${h} and its long hand shows ${m} minutes, so the clock reads ${time}.`;
  } else if (factKind === 'sign') {
    const word = pick(r, SIGN_WORDS);
    scene = withSign(scene, word);
    fact = { type: 'sign' };
    prompt = `${lead}what does the sign in the ${place} say?`;
    correct = word;
    wrongs = sample(r, SIGN_WORDS.filter((w) => w !== word), 3);
    explanation = `The sign in the picture reads "${word}" — it is written in big letters on the board.`;
  } else if (factKind === 'color') {
    const colored = scene.elements.filter((e) => e.color);
    if (!colored.length) return null;
    const el = pick(r, colored);
    fact = { type: 'color', elementId: el.id };
    prompt = `${lead}what colour is the ${el.name} in the ${place}?`;
    correct = colorName(el.color!);
    wrongs = colorDistractors(r, el.color!);
    explanation = `The ${el.name} in the picture is ${el.color} — look at it closely and you can see its colour.`;
  } else if (factKind === 'count') {
    const arts = [...new Set(scene.elements.map((e) => e.art))];
    const art = pick(r, arts);
    const entry = byArt(art);
    const count = scene.elements.filter((e) => e.art === art).length;
    if (count < 2) return null;
    fact = { type: 'count', art };
    prompt = `${lead}how many ${entry.name}s are in the ${place}?`;
    correct = String(count);
    wrongs = [count + 1, count - 1, count + 2].filter((v) => v > 0).map(String);
    if (wrongs.length < 3) wrongs.push(String(count + 3));
    explanation = `Count the ${entry.name}s one by one, pointing at each so none is counted twice: there are ${count}.`;
  } else if (factKind === 'present') {
    const el = pick(r, scene.elements);
    fact = { type: 'present', elementId: el.id };
    const inScene = new Set(scene.elements.map((e) => elementLabel(e).toLowerCase()));
    const absentPool = CATALOG.flatMap((e) => (e.colors ?? [undefined]).map((c) => (c ? `${c} ${e.name}` : e.name)))
      .filter((label) => !inScene.has(label.toLowerCase()));
    wrongs = sample(r, absentPool, 3);
    correct = elementLabel(el);
    prompt = `${lead}which of these can you see in the ${place}?`;
    explanation = `The ${elementLabel(el)} is right there in the picture. The other three choices are not in this scene at all.`;
  } else {
    // absent (memory only in practice): the correct label is something the scene does NOT contain.
    const inScene = new Set(scene.elements.map((e) => elementLabel(e).toLowerCase()));
    const absentPool = CATALOG.flatMap((e) => (e.colors ?? [undefined]).map((c) => (c ? `${c} ${e.name}` : e.name)))
      .filter((label) => !inScene.has(label.toLowerCase()));
    if (!absentPool.length || scene.elements.length < 3) return null;
    const label = pick(r, absentPool);
    fact = { type: 'absent', label };
    correct = label;
    wrongs = sample(r, [...new Set(scene.elements.map((e) => elementLabel(e)))], 3);
    prompt = `${lead}which of these was NOT in the ${place}?`;
    explanation = `The ${label} never appeared in the picture. The other three choices were all there to be spotted.`;
  }
  if (wrongs.length < 3) return null;
  prompt = prompt.charAt(0).toUpperCase() + prompt.slice(1);
  const { options, correctOptionId } = mcOptions(r, correct, wrongs);
  const title = `${kind === 'memory' ? 'Memory' : 'Look closely'}: ${place} ${factKind}`;
  return {
    ...baseGame('', kind, TEMPLATE_WORLD[template], difficulty, title, prompt, explanation),
    options, correctOptionId,
    visual: { gameType: kind, scene, sceneAlt: describeScene(scene), fact },
  };
}

// --- Spot the difference & what changed --------------------------------------------
function mutateScene(r: Rng, scene: SceneSpec, changesWanted: number, difficulty: string): { after: SceneSpec; fakeParts: string[] } {
  const after: SceneSpec = { ...scene, elements: scene.elements.map((e) => ({ ...e })) };
  const targets = sample(r, after.elements, Math.min(changesWanted, after.elements.length));
  // Difficulty honesty: easy changes are the loud ones (colour, removal); moved is medium work and
  // turned-around is the subtlest, so those kinds only appear at their levels.
  const allowed = difficulty === 'easy' ? ['color', 'removed'] : difficulty === 'medium' ? ['color', 'removed', 'moved'] : ['color', 'removed', 'moved', 'turned'];
  for (const el of targets) {
    const kinds = [...allowed, 'color'].filter((k) => k !== 'color' || byArt(el.art).colors);
    const kind = pick(r, kinds);
    if (kind === 'color') {
      const others = byArt(el.art).colors!.filter((c) => c !== el.color);
      el.color = pick(r, others);
    } else if (kind === 'removed') {
      after.elements = after.elements.filter((e) => e.id !== el.id);
    } else if (kind === 'moved') {
      el.x = Math.max(60, Math.min(740, el.x + (r() < 0.5 ? -170 : 170)));
    } else if (kind === 'turned') {
      el.flip = !el.flip;
    }
  }
  // An addition is a reliable third change when the scene is small.
  if (diffScenes(scene, after).length < changesWanted) {
    const free = SLOTS[scene.template].filter((s) => !after.elements.some((e) => Math.abs(e.x - s.x) < 60 && Math.abs(e.y - s.y) < 40));
    if (free.length) {
      const slot = free[0];
      const entry = pick(r, CATALOG.filter((e) => e.zones.includes(slot.zone)));
      after.elements.push(makeElement(r, entry, slot));
    }
  }
  // Fake change descriptions for decoy options: plausible changes that did NOT happen.
  const fakeParts: string[] = [];
  const untouched = scene.elements.filter((e) => !targets.some((t) => t.id === e.id));
  for (const el of sample(r, untouched.length ? untouched : scene.elements, 3)) {
    fakeParts.push(`the ${elementLabel(el)} changed colour from ${el.color ?? 'brown'} to ${el.color === 'purple' ? 'green' : 'purple'}`);
    fakeParts.push(`a ${pick(r, ['red kite', 'blue ball', 'yellow balloon', 'green frog'])} appeared`);
    fakeParts.push(`the ${elementLabel(el)} vanished`);
  }
  return { after, fakeParts };
}

function joinParts(parts: string[]): string {
  if (parts.length === 1) return `Only one thing changed: ${parts[0]}.`;
  const list = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}.`;
}

function diffGame(r: Rng, kind: 'spot-difference' | 'what-changed', difficulty: string): GameDraft | null {
  const template = pick(r, Object.keys(SLOTS) as SceneTemplate[]);
  const size = difficulty === 'easy' ? 5 : difficulty === 'medium' ? 7 : 9;
  const scene = buildScene(r, template, size);
  const wanted = kind === 'spot-difference' ? 3 : 1;
  const { after, fakeParts } = mutateScene(r, scene, wanted, difficulty);
  const changes = diffScenes(scene, after);
  if (changes.length !== wanted) return null;
  const realParts = changes.map((ch) => {
    switch (ch.kind) {
      case 'added': return `a ${ch.label} appeared`;
      case 'removed': return `the ${ch.label} vanished`;
      case 'color': return `the ${ch.label} changed colour from ${ch.from} to ${ch.to}`;
      case 'moved': return `the ${ch.label} moved`;
      case 'turned': return `the ${ch.label} turned around`;
    }
  });
  const correct = joinParts(realParts);
  const wrongs: string[] = [];
  for (let i = 0; i < 3; i++) {
    const parts = [...realParts];
    parts[i % parts.length] = fakeParts[i % fakeParts.length];
    const text = joinParts(parts);
    if (text !== correct && !wrongs.includes(text)) wrongs.push(text);
  }
  if (wrongs.length < 3) return null;
  const { options, correctOptionId } = mcOptions(r, correct, wrongs);
  const place = TEMPLATE_PLACE[template];
  const prompt = kind === 'spot-difference'
    ? `Three things changed between the two ${place} pictures. Which list names all three changes?`
    : `One thing changed between the before and after ${place} pictures. What changed?`;
  const explanation = `Compare the two pictures bit by bit: ${describeChanges(changes).replace(/\.$/, '')}. Nothing else is different.`;
  return {
    ...baseGame('', kind, TEMPLATE_WORLD[template], difficulty, `${kind === 'spot-difference' ? 'Spot the difference' : 'What changed'}: ${place}`, prompt, explanation),
    options, correctOptionId,
    visual: {
      gameType: kind, scene, sceneAlt: describeScene(scene), sceneAfter: after, sceneAfterAlt: describeScene(after),
      expectedChanges: changes.map((ch) => ch.key),
    },
  };
}

// --- Counting -----------------------------------------------------------------------
const COUNT_SETUPS: { template: SceneTemplate; art: string; zone: Zone }[] = [
  { template: 'pond', art: 'duck', zone: 'water' }, { template: 'pond', art: 'fish', zone: 'water' },
  { template: 'pond', art: 'frog', zone: 'water' }, { template: 'meadow', art: 'flower', zone: 'ground' },
  { template: 'meadow', art: 'butterfly', zone: 'sky' }, { template: 'beach', art: 'shell', zone: 'ground' },
  { template: 'beach', art: 'crab', zone: 'ground' }, { template: 'space', art: 'star', zone: 'sky' },
  { template: 'space', art: 'planet', zone: 'sky' }, { template: 'farm', art: 'chicken', zone: 'ground' },
  { template: 'farm', art: 'sheep', zone: 'ground' }, { template: 'garden', art: 'flower', zone: 'ground' },
  { template: 'garden', art: 'bee', zone: 'sky' }, { template: 'park', art: 'bird', zone: 'sky' },
  { template: 'market', art: 'apple', zone: 'counter' }, { template: 'market', art: 'orange', zone: 'counter' },
  { template: 'kitchen', art: 'cupcake', zone: 'counter' }, { template: 'street', art: 'car', zone: 'ground' },
];

function countingGame(r: Rng, difficulty: string): GameDraft | null {
  const setup = pick(r, COUNT_SETUPS);
  const entry = byArt(setup.art);
  const slots = SLOTS[setup.template].filter((s) => s.zone === setup.zone);
  const target = difficulty === 'easy' ? 2 + Math.floor(r() * 4) : difficulty === 'medium' ? 6 + Math.floor(r() * 4) : 9 + Math.floor(r() * 4);
  if (target > slots.length) return null;
  const useColor = difficulty === 'hard' && Boolean(entry.colors) && r() < 0.6;
  const targetColor = useColor ? pick(r, entry.colors!) : undefined;
  const elements: SceneElement[] = [];
  const chosen = sample(r, slots, target + 2);
  for (let i = 0; i < target; i++) {
    elements.push(makeElement(r, entry, chosen[i], targetColor ?? (entry.colors ? pick(r, entry.colors) : undefined)));
  }
  // Decoys: for colour counting, a couple of the same animal in a different colour.
  if (useColor && entry.colors && chosen[target]) {
    const other = entry.colors.find((c) => c !== targetColor)!;
    elements.push(makeElement(r, entry, chosen[target], other));
    if (chosen[target + 1]) elements.push(makeElement(r, entry, chosen[target + 1], other));
  }
  const fillerSlots = SLOTS[setup.template].filter((s) => !elements.some((e) => Math.abs(e.x - s.x) < 60 && Math.abs(e.y - s.y) < 40));
  const fillerCount = difficulty === 'easy' ? 2 : difficulty === 'medium' ? 3 : 4;
  for (const slot of sample(r, fillerSlots, Math.min(fillerCount, fillerSlots.length))) {
    const pool = CATALOG.filter((e) => e.zones.includes(slot.zone) && e.art !== setup.art);
    if (pool.length) elements.push(makeElement(r, pick(r, pool), slot));
  }
  const scene: SceneSpec = { template: setup.template, elements };
  const place = TEMPLATE_PLACE[setup.template];
  const counted = targetColor ? `${targetColor} ${entry.name}` : entry.name;
  const prompt = `How many ${counted}s can you count in the ${place}?`;
  const explanation = `Count the ${counted}s one by one: there are exactly ${target}.` +
    (useColor ? ` Only the ${targetColor} ones count — the other colours are decoys.` : '');
  return {
    ...baseGame('', 'counting', TEMPLATE_WORLD[setup.template], difficulty, `Counting: ${counted}s at the ${place}`, prompt, explanation),
    numberAnswer: { value: target, tolerance: 0 },
    visual: { gameType: 'counting', scene, sceneAlt: describeScene(scene), countTarget: { art: setup.art, ...(targetColor ? { color: targetColor } : {}) } },
  };
}

// --- Sequence recall ------------------------------------------------------------------
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];
function sequenceGame(r: Rng, difficulty: string): GameDraft | null {
  const len = difficulty === 'easy' ? 3 : difficulty === 'medium' ? 4 : 5;
  const combos = shuffle(r, CATALOG.flatMap((e) => (e.colors ?? [undefined]).map((c) => ({ entry: e, color: c }))));
  const chosen = combos.slice(0, len);
  const sequence = chosen.map(({ entry, color }) => ({
    art: entry.art,
    label: color ? `${color} ${entry.name}` : entry.name,
    ...(color ? { color } : {}),
  }));
  if (new Set(sequence.map((s) => s.label)).size !== len) return null;
  const pos = difficulty === 'easy' ? 1 + Math.floor(r() * len) : 2 + Math.floor(r() * (len - 1));
  const correct = sequence[pos - 1].label;
  const wrongs = sequence.filter((_, i) => i !== pos - 1).map((s) => s.label);
  let decoyLabel: string | undefined;
  if (wrongs.length < 3) {
    const extra = combos[len];
    decoyLabel = extra.color ? `${extra.color} ${extra.entry.name}` : extra.entry.name;
    wrongs.push(decoyLabel);
  }
  const { options, correctOptionId } = mcOptions(r, correct, wrongs);
  const orderText = sequence.map((s, i) => `${ORDINALS[i]} the ${s.label}`).join(', ');
  const prompt = `Spark showed some things in order. What came ${ORDINALS[pos - 1]}?`;
  const explanation = `The order was: ${orderText}. So the ${ORDINALS[pos - 1]} one was the ${correct}.`;
  return {
    ...baseGame('', 'sequence', 'play', difficulty, `Sequence recall: what came ${ORDINALS[pos - 1]}?`, prompt, explanation),
    options, correctOptionId,
    visual: { gameType: 'sequence', sequence, askPosition: pos, ...(decoyLabel ? { decoyLabel } : {}) },
  };
}

// --- Legacy rounds (the 17 Nov 2026 starter set) + handcrafted picture rounds --------
// The 17 Nov 2026 starter rounds, kept as generator seed data: content/games/*.json is the
// published source of truth now; these literals only seed a from-scratch regeneration.
type LegacyRound = {
  id: string; kind: string; difficulty: string; prompt: string;
  hero?: { art: string; alt: string };
  options: { id: string; label: string; art?: string; alt?: string }[];
  correctId: string; explanation: string;
};
const LEGACY_ROUNDS: LegacyRound[] = [{ id: "odd-fruit-car", kind: "odd-one-out", difficulty: "easy", prompt: "One of these does not belong. Can you spot it?", options: [{ id: "apple", label: "Apple", art: "apple", alt: "A red apple with a green leaf" }, { id: "banana", label: "Banana", art: "banana", alt: "A bunch of yellow bananas" }, { id: "car", label: "Car", art: "car", alt: "A small blue car" }, { id: "orange", label: "Orange", art: "orange", alt: "A round orange with a leaf" }], correctId: "car", explanation: "The apple, banana and orange are all fruits. The car is a vehicle \u2014 it is the odd one out." }, { id: "odd-flowers-mushroom", kind: "odd-one-out", difficulty: "easy", prompt: "Three of these bloom as flowers. Which one never does?", options: [{ id: "rose", label: "Rose", art: "rose", alt: "A red rose flower on a green stem" }, { id: "mushroom", label: "Mushroom", art: "mushroom", alt: "A red toadstool mushroom with white spots" }, { id: "sunflower", label: "Sunflower", art: "sunflower", alt: "A tall sunflower with a brown centre" }, { id: "tulip", label: "Tulip", art: "tulip", alt: "A pink tulip flower on a green stem" }], correctId: "mushroom", explanation: "Roses, sunflowers and tulips are flowers. A mushroom is a fungus \u2014 it grows, but it never blooms." }, { id: "right-flag-japan", kind: "pick-the-right-one", difficulty: "easy", prompt: "Which flag is Japan?", options: [{ id: "canada", label: "Flag A", art: "flag-ca", alt: "A flag with a red maple leaf between two red bands on white" }, { id: "japan", label: "Flag B", art: "flag-jp", alt: "A white flag with a single red circle in the centre" }, { id: "switzerland", label: "Flag C", art: "flag-ch", alt: "A red square flag with a white cross in the centre" }, { id: "south-korea", label: "Flag D", art: "flag-kr", alt: "A white flag with a red-and-blue circle in the centre and black marks in the corners" }], correctId: "japan", explanation: "Japan\u2019s flag is white with a single red disc in the centre, representing the sun \u2014 Japan is called the Land of the Rising Sun." }, { id: "right-penguin", kind: "pick-the-right-one", difficulty: "easy", prompt: "Which animal is a penguin?", options: [{ id: "owl", label: "Owl", art: "owl", alt: "A brown owl with big round eyes perched upright" }, { id: "flamingo", label: "Flamingo", art: "flamingo", alt: "A tall pink flamingo standing on one leg" }, { id: "duck", label: "Duck", art: "duck", alt: "A yellow duck with an orange bill" }, { id: "penguin", label: "Penguin", art: "penguin", alt: "A black-and-white penguin with an orange beak and feet" }], correctId: "penguin", explanation: "The penguin is the black-and-white bird with a white belly, orange beak and feet. Penguins cannot fly, but they swim beautifully." }, { id: "place-eiffel", kind: "flags-and-places", difficulty: "easy", prompt: "This famous tower stands in which country?", hero: { art: "eiffel", alt: "The Eiffel Tower, a tall iron lattice tower, against a blue sky" }, options: [{ id: "italy", label: "Italy", art: "flag-it", alt: "The flag of Italy: green, white and red vertical stripes" }, { id: "france", label: "France", art: "flag-fr", alt: "The flag of France: blue, white and red vertical stripes" }, { id: "spain", label: "Spain", art: "flag-es", alt: "The flag of Spain: red, yellow and red horizontal stripes" }, { id: "germany", label: "Germany", art: "flag-de", alt: "The flag of Germany: black, red and gold horizontal stripes" }], correctId: "france", explanation: "The Eiffel Tower stands in Paris, the capital of France. It was finished in 1889 for the World\u2019s Fair." }, { id: "place-brazil-flag", kind: "flags-and-places", difficulty: "medium", prompt: "This flag \u2014 green, with a yellow diamond and a blue globe \u2014 belongs to which country?", hero: { art: "flag-br", alt: "The flag of Brazil: green with a yellow diamond and a blue circle with white stars" }, options: [{ id: "argentina", label: "Argentina" }, { id: "mexico", label: "Mexico" }, { id: "brazil", label: "Brazil" }, { id: "portugal", label: "Portugal" }], correctId: "brazil", explanation: "That is Brazil\u2019s flag. The blue globe shows stars as they appeared over Rio de Janeiro on 15 November 1889." }, { id: "place-canada-reverse", kind: "flags-and-places", difficulty: "medium", prompt: "Reverse round: which flag belongs to Canada?", options: [{ id: "usa", label: "Flag A", art: "flag-us", alt: "A flag with red and white stripes and white stars on a blue canton" }, { id: "uk", label: "Flag B", art: "flag-gb", alt: "A blue flag with red and white crosses layered over each other" }, { id: "canada", label: "Flag C", art: "flag-ca", alt: "A flag with a red maple leaf between two red bands on white" }, { id: "australia", label: "Flag D", art: "flag-au", alt: "A dark blue flag with a small Union Jack in the corner and white stars" }], correctId: "canada", explanation: "Canada\u2019s flag has a single red maple leaf in the centre, between two red bands. It was first flown in 1965." }];

const LEGACY_TITLES: Record<string, string> = {
  'odd-fruit-car': 'Odd one out: three fruits and a car',
  'odd-flowers-mushroom': 'Odd one out: the one that never blooms',
  'right-flag-japan': 'Pick the right one: the flag of Japan',
  'right-penguin': 'Pick the right one: find the penguin',
  'place-eiffel': 'Flags & places: the Eiffel Tower',
  'place-brazil-flag': 'Flags & places: green, gold and a starry globe',
  'place-canada-reverse': 'Flags & places: which flag is Canada’s?',
};

function legacyGames(): GameDraft[] {
  return LEGACY_ROUNDS.map((round) => {
    const choices = round.options.map((o) => ({ id: o.id, text: o.label, ...(o.art ? { art: o.art, alt: o.alt ?? o.label } : {}) }));
    const draft: GameDraft = {
      ...baseGame(round.id, round.kind, 'play', round.difficulty, LEGACY_TITLES[round.id] ?? round.prompt, round.prompt, round.explanation),
      scheduledDate: TODAY,
      correctOptionId: round.correctId,
      visual: { gameType: round.kind, ...(round.hero ? { heroArt: round.hero.art, heroAlt: round.hero.alt } : {}) },
    };
    if (round.kind === 'odd-one-out') draft.items = choices;
    else draft.options = choices;
    return draft;
  });
}

type FlagFact = { art: string; country: string; note: string };
const FLAGS: FlagFact[] = [
  { art: 'flag-jp', country: 'Japan', note: 'Japan’s flag is white with a single red disc for the sun.' },
  { art: 'flag-ca', country: 'Canada', note: 'Canada’s flag has a red maple leaf between two red bands.' },
  { art: 'flag-ch', country: 'Switzerland', note: 'Switzerland’s flag is a red square with a bold white cross.' },
  { art: 'flag-kr', country: 'South Korea', note: 'South Korea’s flag has a red-and-blue circle in the centre on white.' },
  { art: 'flag-fr', country: 'France', note: 'France’s flag is blue, white and red in vertical stripes.' },
  { art: 'flag-it', country: 'Italy', note: 'Italy’s flag is green, white and red in vertical stripes.' },
  { art: 'flag-es', country: 'Spain', note: 'Spain’s flag is red, gold and red in horizontal stripes.' },
  { art: 'flag-de', country: 'Germany', note: 'Germany’s flag is black, red and gold in horizontal stripes.' },
  { art: 'flag-ar', country: 'Argentina', note: 'Argentina’s flag is sky blue and white with a golden sun.' },
  { art: 'flag-mx', country: 'Mexico', note: 'Mexico’s flag is green, white and red with an eagle emblem in the centre.' },
  { art: 'flag-br', country: 'Brazil', note: 'Brazil’s flag is green with a yellow diamond and a blue starry globe.' },
  { art: 'flag-pt', country: 'Portugal', note: 'Portugal’s flag is green and red with a yellow armillary sphere.' },
  { art: 'flag-us', country: 'United States', note: 'The United States flag has red and white stripes and white stars on blue.' },
  { art: 'flag-gb', country: 'United Kingdom', note: 'The United Kingdom’s Union Jack layers red and white crosses on blue.' },
  { art: 'flag-au', country: 'Australia', note: 'Australia’s flag is dark blue with a small Union Jack and white stars.' },
];

function flagGames(r: Rng): GameDraft[] {
  const games: GameDraft[] = [];
  const combos = shuffle(r, FLAGS);
  // Forward rounds: name the country, pick its flag (art options labelled A–D).
  for (let i = 0; i < 6; i++) {
    const target = combos[i % combos.length];
    const distractors = sample(r, FLAGS.filter((f) => f.art !== target.art), 3);
    const all = shuffle(r, [target, ...distractors]);
    const options = all.map((f, j) => ({ id: LETTERS[j], text: `Flag ${'ABCD'[j]}`, art: f.art, alt: `A flag: ${f.note}` }));
    games.push({
      ...baseGame('', 'flags-and-places', 'discover', i < 3 ? 'easy' : 'medium', `Flags & places: which flag is ${target.country}?`,
        `Which flag belongs to ${target.country}?`, `${target.note} The other flags belong to ${distractors.map((d) => d.country).join(', ')}.`),
      options, correctOptionId: options.find((o) => o.art === target.art)!.id,
      visual: { gameType: 'flags-and-places' },
    });
  }
  // Reverse rounds: the flag is the hero; the options are country names (text-only, hero rule).
  for (let i = 0; i < 4; i++) {
    const target = combos[(i + 6) % combos.length];
    const distractors = sample(r, FLAGS.filter((f) => f.art !== target.art), 3);
    const { options, correctOptionId } = mcOptions(r, target.country, distractors.map((d) => d.country));
    games.push({
      ...baseGame('', 'flags-and-places', 'discover', 'medium', `Flags & places: name this flag`,
        `This flag belongs to which country?`, target.note),
      options, correctOptionId,
      visual: { gameType: 'flags-and-places', heroArt: target.art, heroAlt: `A flag: ${target.note}` },
    });
  }
  return games;
}

function handcraftedRounds(r: Rng): GameDraft[] {
  const games: GameDraft[] = [];
  const oddSets: { items: { id: string; text: string; art: string; alt: string }[]; correct: string; prompt: string; explanation: string; title: string }[] = [
    {
      title: 'Odd one out: three birds and a fungus',
      prompt: 'One of these does not belong. Can you spot it?',
      items: [
        { id: 'owl', text: 'Owl', art: 'owl', alt: 'A brown owl with big round eyes' },
        { id: 'flamingo', text: 'Flamingo', art: 'flamingo', alt: 'A tall pink flamingo on one leg' },
        { id: 'duck', text: 'Duck', art: 'duck', alt: 'A yellow duck with an orange bill' },
        { id: 'mushroom', text: 'Mushroom', art: 'mushroom', alt: 'A red toadstool mushroom with white spots' },
      ],
      correct: 'mushroom',
      explanation: 'The owl, flamingo and duck are all birds. The mushroom is a fungus — it is the odd one out.',
    },
    {
      title: 'Odd one out: three flowers and a fruit',
      prompt: 'Three of these are flowers. Which one is not?',
      items: [
        { id: 'rose', text: 'Rose', art: 'rose', alt: 'A red rose on a green stem' },
        { id: 'tulip', text: 'Tulip', art: 'tulip', alt: 'A pink tulip on a green stem' },
        { id: 'sunflower', text: 'Sunflower', art: 'sunflower', alt: 'A tall sunflower with a brown centre' },
        { id: 'apple', text: 'Apple', art: 'apple', alt: 'A red apple with a green leaf' },
      ],
      correct: 'apple',
      explanation: 'Roses, tulips and sunflowers are flowers. An apple is a fruit that grows on a tree.',
    },
    {
      title: 'Odd one out: three fruits and a fungus',
      prompt: 'One of these does not belong. Can you spot it?',
      items: [
        { id: 'apple', text: 'Apple', art: 'apple', alt: 'A red apple with a green leaf' },
        { id: 'banana', text: 'Banana', art: 'banana', alt: 'A bunch of yellow bananas' },
        { id: 'orange', text: 'Orange', art: 'orange', alt: 'A round orange with a leaf' },
        { id: 'mushroom', text: 'Mushroom', art: 'mushroom', alt: 'A red toadstool mushroom with white spots' },
      ],
      correct: 'mushroom',
      explanation: 'Apples, bananas and oranges are fruits. A mushroom is a fungus, not a fruit.',
    },
    {
      title: 'Odd one out: three birds and a vehicle',
      prompt: 'One of these does not belong. Can you spot it?',
      items: [
        { id: 'duck', text: 'Duck', art: 'duck', alt: 'A yellow duck with an orange bill' },
        { id: 'penguin', text: 'Penguin', art: 'penguin', alt: 'A black-and-white penguin' },
        { id: 'flamingo', text: 'Flamingo', art: 'flamingo', alt: 'A tall pink flamingo on one leg' },
        { id: 'car', text: 'Car', art: 'car', alt: 'A small blue car' },
      ],
      correct: 'car',
      explanation: 'The duck, penguin and flamingo are birds. The car is a vehicle with wheels — the odd one out.',
    },
  ];
  for (const set of oddSets) {
    games.push({
      ...baseGame('', 'odd-one-out', 'play', 'easy', set.title, set.prompt, set.explanation),
      items: shuffle(r, set.items), correctOptionId: set.correct,
      visual: { gameType: 'odd-one-out' },
    });
  }
  const pickSets: { options: { id: string; text: string; art: string; alt: string }[]; correct: string; prompt: string; explanation: string; title: string }[] = [
    {
      title: 'Pick the right one: find the owl',
      prompt: 'Which animal is an owl?',
      options: [
        { id: 'owl', text: 'Owl', art: 'owl', alt: 'A brown owl with big round eyes' },
        { id: 'flamingo', text: 'Flamingo', art: 'flamingo', alt: 'A tall pink flamingo on one leg' },
        { id: 'duck', text: 'Duck', art: 'duck', alt: 'A yellow duck with an orange bill' },
        { id: 'penguin', text: 'Penguin', art: 'penguin', alt: 'A black-and-white penguin' },
      ],
      correct: 'owl',
      explanation: 'The owl is the brown bird with huge round eyes. Owls hunt at night and can turn their heads a long way round.',
    },
    {
      title: 'Pick the right one: find the tulip',
      prompt: 'Which flower is a tulip?',
      options: [
        { id: 'rose', text: 'Rose', art: 'rose', alt: 'A red rose on a green stem' },
        { id: 'tulip', text: 'Tulip', art: 'tulip', alt: 'A pink tulip with cup-shaped petals' },
        { id: 'sunflower', text: 'Sunflower', art: 'sunflower', alt: 'A tall sunflower with a brown centre' },
        { id: 'mushroom', text: 'Mushroom', art: 'mushroom', alt: 'A red toadstool mushroom with white spots' },
      ],
      correct: 'tulip',
      explanation: 'The tulip is the pink, cup-shaped flower. The mushroom beside it is not a flower at all.',
    },
    {
      title: 'Pick the right one: the bird that cannot fly',
      prompt: 'Which of these birds cannot fly?',
      options: [
        { id: 'owl', text: 'Owl', art: 'owl', alt: 'A brown owl with big round eyes' },
        { id: 'flamingo', text: 'Flamingo', art: 'flamingo', alt: 'A tall pink flamingo on one leg' },
        { id: 'duck', text: 'Duck', art: 'duck', alt: 'A yellow duck with an orange bill' },
        { id: 'penguin', text: 'Penguin', art: 'penguin', alt: 'A black-and-white penguin' },
      ],
      correct: 'penguin',
      explanation: 'Penguins cannot fly — their wings are flippers for swimming. Owls, flamingos and ducks all fly.',
    },
  ];
  for (const set of pickSets) {
    games.push({
      ...baseGame('', 'pick-the-right-one', 'play', 'easy', set.title, set.prompt, set.explanation),
      options: shuffle(r, set.options), correctOptionId: set.correct,
      visual: { gameType: 'pick-the-right-one' },
    });
  }
  return games;
}

// --- Main: quotas, ids, dating, writing -----------------------------------------------
const QUOTAS: { type: string; count: number }[] = [
  { type: 'observation', count: 58 },
  { type: 'memory', count: 58 },
  { type: 'spot-difference', count: 56 },
  { type: 'what-changed', count: 54 },
  { type: 'counting', count: 56 },
  { type: 'sequence', count: 54 },
];
const DIFFS = ['easy', 'medium', 'hard'];
const FACT_KINDS: FactKind[] = ['clock', 'sign', 'color', 'count', 'present'];
const KIDS_TEMPLATES: SceneTemplate[] = ['pond', 'farm', 'beach', 'garden', 'meadow'];

function generate() {
  fs.mkdirSync(OUT, { recursive: true });
  const games: GameDraft[] = [...legacyGames()];
  const r0 = rng(Number(process.env.GAME_SEED ?? 20261118));
  games.push(...flagGames(r0), ...handcraftedRounds(r0));

  let kidsMade = 0;
  for (const { type, count } of QUOTAS) {
    let made = 0;
    let attempts = 0;
    while (made < count && attempts < count * 30) {
      attempts += 1;
      const difficulty = DIFFS[made % 3];
      const r = rng(1000 + games.length * 131 + attempts * 17 + made);
      let draft: GameDraft | null = null;
      if (type === 'observation') draft = factGame(r, 'observation', difficulty, made, FACT_KINDS[made % FACT_KINDS.length]);
      else if (type === 'memory') draft = factGame(r, 'memory', difficulty, made, made % 5 === 4 ? 'absent' : FACT_KINDS[made % FACT_KINDS.length]);
      else if (type === 'spot-difference') draft = diffGame(r, 'spot-difference', difficulty);
      else if (type === 'what-changed') draft = diffGame(r, 'what-changed', difficulty);
      else if (type === 'counting') draft = countingGame(r, difficulty);
      else if (type === 'sequence') draft = sequenceGame(r, difficulty);
      if (!draft) continue;
      // Kids quota: a share of the easy games in gentle templates become Kids-world games.
      const visual = draft.visual as { scene?: SceneSpec };
      if (difficulty === 'easy' && kidsMade < 52 && visual.scene && KIDS_TEMPLATES.includes(visual.scene.template)) {
        draft.brand = 'kids';
        kidsMade += 1;
      }
      draft.id = '';
      games.push(draft);
      made += 1;
    }
    if (made < count) throw new Error(`Quota shortfall for ${type}: ${made}/${count}`);
  }

  // IDs + dating: legacy rounds keep their ids and play today. New games get readable ids; the
  // first 40% are dated on or before today (playable at once), the rest join the daily runway
  // two per day from tomorrow.
  const counters = new Map<string, number>();
  const fresh = games.filter((g) => !g.id);
  fresh.forEach((g) => {
    const type = String(g.gameType);
    const n = (counters.get(type) ?? 0) + 1;
    counters.set(type, n);
    g.id = `${type}-${String(n).padStart(3, '0')}`;
  });
  const immediateCount = Math.floor(fresh.length * 0.4);
  const dayMs = 86400000;
  const todayMs = Date.parse(`${TODAY}T00:00:00Z`);
  fresh.forEach((g, i) => {
    if (i < immediateCount) {
      const back = Math.floor((i / Math.max(1, immediateCount)) * 10);
      g.scheduledDate = new Date(todayMs - back * dayMs).toISOString().slice(0, 10);
    } else {
      const ahead = Math.floor((i - immediateCount) / 2) + 1;
      g.scheduledDate = new Date(todayMs + ahead * dayMs).toISOString().slice(0, 10);
    }
  });

  // Prove every game through the schema before it touches disk.
  let written = 0;
  let skipped = 0;
  for (const draft of games) {
    const parsed = gameSchema.safeParse(draft);
    if (!parsed.success) {
      console.error(`SKIP ${draft.id}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      skipped += 1;
      continue;
    }
    const file = path.join(OUT, `${draft.id}.json`);
    if (fs.existsSync(file) && !FORCE) { skipped += 1; continue; }
    fs.writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`);
    written += 1;
  }
  const byType = new Map<string, number>();
  const byDiff = new Map<string, number>();
  for (const g of games) {
    byType.set(String(g.gameType), (byType.get(String(g.gameType)) ?? 0) + 1);
    byDiff.set(String(g.difficulty), (byDiff.get(String(g.difficulty)) ?? 0) + 1);
  }
  console.log(`Games: ${games.length} total (${written} written, ${skipped} skipped)`);
  console.log('By type:', Object.fromEntries(byType));
  console.log('By difficulty:', Object.fromEntries(byDiff));
  console.log('Kids brand:', games.filter((g) => g.brand === 'kids').length);
}

generate();
