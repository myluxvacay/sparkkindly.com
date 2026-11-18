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
] as const;
export type GameType = (typeof GAME_TYPES)[number];

export type SequenceEntry = { art: string; label: string; color?: SceneColor };

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
};
