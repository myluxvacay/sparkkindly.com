// Parametric picture scenes for the visual games (owner direction, 18 Nov 2026).
//
// A scene is data, not a picture file: a template backdrop, optional fixtures (a clock, a sign) and a
// list of placed elements drawn by components/games/SceneArt.tsx. Because the scene is data, every
// game's answer is DERIVED here — count the ducks, diff the two scenes, read the clock — and the
// content schema (lib/schemas.ts) recomputes the derivation and refuses a game whose stored answer
// disagrees. That is what makes 300+ generated games safe to publish: correctness is proven at the
// content gate, not eyeballed.
//
// Element identity is the `id` (unique within a scene). The display label is derived from colour +
// name ("pink duck"), never stored, so a colour change in a diff scene changes the label too.

export const SCENE_TEMPLATES = [
  'pond',
  'meadow',
  'farm',
  'station',
  'market',
  'kitchen',
  'beach',
  'classroom',
  'park',
  'space',
  'garden',
  'street',
] as const;
export type SceneTemplate = (typeof SCENE_TEMPLATES)[number];

export const SCENE_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'brown',
  'white',
  'black',
  'gray',
] as const;
export type SceneColor = (typeof SCENE_COLORS)[number];

/** Hex fills for the named colours, shared by the scene renderer. */
export const COLOR_HEX: Record<SceneColor, string> = {
  red: '#d43a2f',
  orange: '#f58a1f',
  yellow: '#f7d038',
  green: '#3f9e4d',
  blue: '#3b6fd4',
  purple: '#7d4fc9',
  pink: '#f28bb4',
  brown: '#8a5a33',
  white: '#ffffff',
  black: '#22252d',
  gray: '#9aa3ad',
};

/** Every art key SceneArt can draw. The schema rejects a scene element whose art is not listed here. */
export const SCENE_ART_KEYS = [
  'duck', 'cat', 'dog', 'bird', 'fish', 'frog', 'butterfly', 'bee', 'ladybug', 'snail', 'turtle',
  'crab', 'penguin', 'owl', 'cow', 'pig', 'sheep', 'horse', 'chicken', 'rabbit', 'fox', 'bear',
  'elephant', 'tree', 'pine', 'flower', 'mushroom', 'star', 'moon', 'cloud', 'balloon', 'kite',
  'ball', 'book', 'apple', 'banana', 'orange', 'grapes', 'carrot', 'cupcake', 'shell', 'boat',
  'train', 'car', 'rocket', 'planet', 'house', 'gift', 'hat', 'umbrella', 'snowman', 'pumpkin',
] as const;
export type SceneArtKey = (typeof SCENE_ART_KEYS)[number];

export type SceneElement = {
  id: string;
  /** SceneArt key, e.g. 'duck'. Must be in SCENE_ART. */
  art: string;
  /** Plain name without colour, e.g. 'duck', 'beach ball'. */
  name: string;
  color?: SceneColor;
  /** Anchor in the 800x520 viewBox: x is the element's centre, y its base (feet). */
  x: number;
  y: number;
  scale?: number;
  flip?: boolean;
};

export type SceneSpec = {
  template: SceneTemplate;
  /** When present, templates that carry a clock draw it showing this time, "H:MM". */
  clockTime?: string;
  /** When present, templates that carry a sign board print this text. */
  signText?: string;
  elements: SceneElement[];
};

export const elementLabel = (el: SceneElement): string => (el.color ? `${el.color} ${el.name}` : el.name);

// ---------------------------------------------------------------------------
// Template backdrop objects — what each template draws BEFORE any element is placed.
//
// Facts are derived from element data, but the player answers from the whole rendered picture,
// backdrop included (owner report, 18 Nov 2026: observation-030's correct answer was a small
// yellow house element while the farm backdrop's big RED barn — also a house to any player —
// dominated the scene). So every intrinsic backdrop object is catalogued here in the same
// vocabulary facts and labels speak in (plain noun + the colours a player would name), and the
// content schema (lib/schemas.ts) refuses a game whose answer the backdrop makes ambiguous:
// a fact may not hinge on a category the backdrop also draws in another colour or form.
// Keep this catalogue in step with the Backdrop switch in components/games/SceneView.tsx —
// the rendered render review (docs/reviews) is the check that the two agree.
// ---------------------------------------------------------------------------

export type TemplateObject = {
  /** The plain noun a player would use for it, e.g. 'house' for the farm barn. */
  name: string;
  /** The colours a player would name for it; empty when it has no one naming colour. */
  colors: SceneColor[];
  count: number | 'many';
  note: string;
};

export const TEMPLATE_OBJECTS: Record<SceneTemplate, TemplateObject[]> = {
  pond: [
    { name: 'sun', colors: ['yellow'], count: 1, note: 'Sun in the sky' },
    { name: 'pond', colors: ['blue'], count: 1, note: 'The pond water itself' },
    { name: 'reeds', colors: ['green'], count: 3, note: 'Reed strokes at the water edge' },
  ],
  meadow: [
    { name: 'sun', colors: ['yellow'], count: 1, note: 'Sun in the sky' },
    { name: 'hill', colors: ['green'], count: 2, note: 'Rolling green hills' },
  ],
  farm: [
    { name: 'house', colors: ['red'], count: 1, note: 'The big red barn — players read it as the farm’s house' },
    { name: 'fence', colors: ['white'], count: 1, note: 'Cream fence rails across the field' },
    { name: 'sun', colors: ['yellow'], count: 1, note: 'Sun in the sky' },
  ],
  station: [
    { name: 'roof', colors: ['gray'], count: 1, note: 'Station canopy roof' },
    { name: 'tracks', colors: ['gray'], count: 1, note: 'Rail tracks along the platform' },
    // Fixtures are exempt in every template that carries them (station/kitchen/classroom/park
    // clocks; market/station/street/garden/beach sign boards): they render only from
    // scene.clockTime / scene.signText and are answered by the clock/sign facts themselves,
    // so they are not collisions.
  ],
  market: [
    { name: 'awning', colors: ['red', 'white'], count: 1, note: 'Striped market awning' },
    { name: 'counter', colors: ['brown'], count: 1, note: 'Wooden market counter' },
  ],
  kitchen: [
    { name: 'window', colors: [], count: 1, note: 'Kitchen window' },
    { name: 'sun', colors: ['yellow'], count: 1, note: 'Sun visible through the window' },
    { name: 'lamp', colors: ['yellow'], count: 1, note: 'Hanging lamp' },
  ],
  beach: [
    { name: 'sun', colors: ['yellow'], count: 1, note: 'Sun in the sky' },
    { name: 'sea', colors: ['blue'], count: 1, note: 'The sea' },
    { name: 'sand', colors: [], count: 1, note: 'The sand' },
  ],
  classroom: [
    { name: 'chalkboard', colors: ['green'], count: 1, note: 'Green chalkboard with chalk lines' },
  ],
  park: [
    { name: 'sun', colors: ['yellow'], count: 1, note: 'Sun in the sky' },
    { name: 'bench', colors: ['brown'], count: 1, note: 'Park bench' },
    { name: 'path', colors: [], count: 1, note: 'Winding path' },
  ],
  space: [
    { name: 'star', colors: ['white'], count: 'many', note: 'About fifteen small white star dots across the sky' },
    { name: 'moon', colors: ['yellow'], count: 1, note: 'Pale moon-like disc, top right' },
    { name: 'planet', colors: ['purple'], count: 1, note: 'The big planet surface the scene stands on' },
  ],
  garden: [
    { name: 'sun', colors: ['yellow'], count: 1, note: 'Sun in the sky' },
    { name: 'hedge', colors: ['green'], count: 1, note: 'Hedge row' },
    { name: 'pebble', colors: ['gray', 'brown'], count: 'many', note: 'Pebbles scattered in the soil rows' },
  ],
  street: [
    { name: 'house', colors: ['brown', 'blue', 'pink'], count: 3, note: 'Three buildings — players read them as houses' },
    { name: 'road', colors: ['gray'], count: 1, note: 'The road with yellow dashes' },
  ],
};

/** Split a display label ("yellow house", "bunch of grapes") into its colour word and noun. */
export function splitLabel(label: string): { color?: SceneColor; noun: string } {
  const words = label.trim().toLowerCase().split(/\s+/);
  if (words.length > 1 && (SCENE_COLORS as readonly string[]).includes(words[0])) {
    return { color: words[0] as SceneColor, noun: words.slice(1).join(' ') };
  }
  return { noun: words.join(' ') };
}

/** Backdrop objects of `template` whose noun is `noun` — the collisions a fact must not trip over. */
export function templateCollisions(template: SceneTemplate, noun: string): TemplateObject[] {
  return (TEMPLATE_OBJECTS[template] ?? []).filter((o) => o.name === noun);
}

/** A one-paragraph description of the scene, used as the accessible text for the picture. */
export function describeScene(scene: SceneSpec): string {
  const parts: string[] = [`A ${scene.template} scene.`];
  if (scene.clockTime) parts.push(`A clock shows ${scene.clockTime}.`);
  if (scene.signText) parts.push(`A sign reads "${scene.signText}".`);
  if (scene.elements.length) {
    parts.push(`In the scene: ${scene.elements.map(elementLabel).join(', ')}.`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Derivations — the provable answers.
// ---------------------------------------------------------------------------

export function countInScene(scene: SceneSpec, target: { art: string; color?: SceneColor }): number {
  return scene.elements.filter((el) => el.art === target.art && (target.color === undefined || el.color === target.color)).length;
}

export type SceneChangeKind = 'added' | 'removed' | 'color' | 'moved' | 'turned';
export type SceneChange = {
  /** Canonical key, stored in the game file and compared by the schema proof. */
  key: string;
  kind: SceneChangeKind;
  elementId: string;
  /** Display label of the element (in the "after" scene when it exists there). */
  label: string;
  from?: string;
  to?: string;
};

const MOVE_EPSILON = 4;

export function diffScenes(before: SceneSpec, after: SceneSpec): SceneChange[] {
  const changes: SceneChange[] = [];
  const beforeById = new Map(before.elements.map((el) => [el.id, el]));
  const afterById = new Map(after.elements.map((el) => [el.id, el]));
  for (const el of after.elements) {
    const prev = beforeById.get(el.id);
    if (!prev) {
      changes.push({ key: `${el.id}:added`, kind: 'added', elementId: el.id, label: elementLabel(el) });
      continue;
    }
    if (prev.color !== el.color) {
      changes.push({
        key: `${el.id}:color:${prev.color ?? 'plain'}->${el.color ?? 'plain'}`,
        kind: 'color',
        elementId: el.id,
        label: elementLabel(el),
        from: prev.color ?? 'plain',
        to: el.color ?? 'plain',
      });
    }
    if (Math.abs(prev.x - el.x) > MOVE_EPSILON || Math.abs(prev.y - el.y) > MOVE_EPSILON) {
      changes.push({ key: `${el.id}:moved`, kind: 'moved', elementId: el.id, label: elementLabel(el) });
    }
    if (Boolean(prev.flip) !== Boolean(el.flip)) {
      changes.push({ key: `${el.id}:turned`, kind: 'turned', elementId: el.id, label: elementLabel(el) });
    }
  }
  for (const el of before.elements) {
    if (!afterById.has(el.id)) {
      changes.push({ key: `${el.id}:removed`, kind: 'removed', elementId: el.id, label: elementLabel(el) });
    }
  }
  return changes;
}

export function describeChange(change: SceneChange): string {
  switch (change.kind) {
    case 'added':
      return `a ${change.label} appeared`;
    case 'removed':
      return `the ${change.label} vanished`;
    case 'color':
      return `the ${change.label} changed colour from ${change.from} to ${change.to}`;
    case 'moved':
      return `the ${change.label} moved`;
    case 'turned':
      return `the ${change.label} turned around`;
  }
}

/** The canonical correct-option text for a difference game: every change, in diff order. */
export function describeChanges(changes: SceneChange[]): string {
  const parts = changes.map(describeChange);
  if (parts.length === 0) return 'Nothing changed';
  if (parts.length === 1) return `Only one thing changed: ${parts[0]}.`;
  const list = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}.`;
}

// ---------------------------------------------------------------------------
// Facts — the provable answers for observation and memory games.
// ---------------------------------------------------------------------------

export type SceneFact =
  | { type: 'clock' }
  | { type: 'sign' }
  | { type: 'color'; elementId: string }
  | { type: 'count'; art: string; color?: SceneColor }
  | { type: 'present'; elementId: string }
  | { type: 'absent'; label: string };

/** The fact's value as it should appear in the correct option's text; null when the scene cannot answer it. */
export function factValue(scene: SceneSpec, fact: SceneFact): string | null {
  switch (fact.type) {
    case 'clock':
      return scene.clockTime ?? null;
    case 'sign':
      return scene.signText ?? null;
    case 'color': {
      const el = scene.elements.find((e) => e.id === fact.elementId);
      return el?.color ?? null;
    }
    case 'count':
      return String(countInScene(scene, fact));
    case 'present': {
      const el = scene.elements.find((e) => e.id === fact.elementId);
      return el ? elementLabel(el) : null;
    }
    case 'absent': {
      // Provable only when the named thing really is absent: no element may carry that label.
      const labels = new Set(scene.elements.map((e) => elementLabel(e).toLowerCase()));
      return labels.has(fact.label.toLowerCase()) ? null : fact.label;
    }
  }
}

/** Normalised comparison for answer texts (case/whitespace-insensitive). */
export const sameText = (a: string, b: string): boolean =>
  a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');

/** The game types whose rounds carry a `visual` block. */
export const GAME_TYPES = [
  'observation',
  'memory',
  'spot-difference',
  'what-changed',
  'counting',
  'sequence',
  'odd-one-out',
  'pick-the-right-one',
  'flags-and-places',
  // Wave 1 (owner direction, 21 Nov 2026): five new types, sampled on staging first.
  'drag-match',
  'fact-or-fiction',
  'pattern',
  'emotion-detectives',
  'build-a-word',
] as const;
export type GameType = (typeof GAME_TYPES)[number];

export type SequenceEntry = { art: string; label: string; color?: SceneColor };

/** One draggable piece in a drag-match game. `value` is set on number pieces (the hedgehog cones). */
export type MatchPiece = { id: string; text: string; art?: string; alt?: string; value?: number };
/** One drop target in a drag-match game. `dots` is set on dot-count targets (the hedgehog circles). */
export type MatchTarget = { id: string; text: string; art?: string; alt?: string; dots?: number };
export type MatchSpec = { variant?: 'dots' | 'match'; pieces: MatchPiece[]; targets: MatchTarget[] };

export type VisualBlock = {
  gameType: GameType;
  scene?: SceneSpec;
  sceneAlt?: string;
  sceneAfter?: SceneSpec;
  sceneAfterAlt?: string;
  sequence?: SequenceEntry[];
  /** 1-based position the prompt asks about, for sequence games. */
  askPosition?: number;
  /** A declared decoy label for sequence games whose sequence has only 3 entries (4 options needed). */
  decoyLabel?: string;
  heroArt?: string;
  heroAlt?: string;
  fact?: SceneFact;
  countTarget?: { art: string; color?: SceneColor };
  /** Canonical change keys from diffScenes, stored so the proof compares like with like. */
  expectedChanges?: string[];
  /** Drag-match (wave 1): the pieces, the targets, and how the board is drawn. The game's
   *  `matchAnswer` (piece ids in target order) is proven against this data by the schema. */
  match?: MatchSpec;
  /** Fact-or-fiction (wave 1): the statement the player judges, and whether it is a fact. */
  statement?: string;
  statementIsFact?: boolean;
  /** Emotion detectives (wave 1): the little story the player reads the feeling from, and the
   *  feeling the correct option must name. */
  scenario?: string;
  feeling?: string;
  /** Pattern (wave 1): the 1-based position in `sequence` the strip hides and the options offer. */
  missingPosition?: number;
  /** Build-a-word (wave 1): the letter tiles on the table — exactly the word's letters, plus the
   *  one declared decoy letter when `decoyLetter` is set. Proven against `wordAnswer`. */
  tiles?: string[];
  decoyLetter?: string;
};
