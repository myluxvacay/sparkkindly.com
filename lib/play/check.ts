import type { Mechanic } from '@/lib/items/format';

const MAX_INPUT = 200;

// Case-insensitive, whitespace-collapsed, punctuation-free comparison form.
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const accepted = (x: unknown): string[] | null =>
  isRecord(x) && Array.isArray(x.accepted) && x.accepted.every((s) => typeof s === 'string') ? (x.accepted as string[]) : null;

function parseOrder(params: URLSearchParams, itemIds?: string[]): string[] | null {
  if (!itemIds || itemIds.length === 0) return null;
  const known = new Set(itemIds.map((id) => `pos-${id}`));
  for (const key of params.keys()) if (key.startsWith('pos-') && !known.has(key)) return null; // unknown id
  const slots: (string | undefined)[] = new Array(itemIds.length).fill(undefined);
  for (const id of itemIds) {
    const raw = params.get(`pos-${id}`);
    if (raw === null || !/^\d{1,2}$/.test(raw)) return null;
    const pos = Number(raw);
    if (pos < 1 || pos > itemIds.length || slots[pos - 1] !== undefined) return null; // out of range or reused
    slots[pos - 1] = id;
  }
  return slots as string[];
}

function parseMatch(params: URLSearchParams, targetIds?: string[], pieceIds?: string[]): string[] | null {
  if (!targetIds || targetIds.length === 0 || !pieceIds || pieceIds.length === 0) return null;
  const known = new Set(targetIds.map((id) => `match-${id}`));
  for (const key of params.keys()) if (key.startsWith('match-') && !known.has(key)) return null; // unknown target
  const pieces = new Set(pieceIds);
  const used = new Set<string>();
  const slots: string[] = [];
  for (const id of targetIds) {
    const raw = params.get(`match-${id}`);
    if (raw === null || !pieces.has(raw) || used.has(raw)) return null; // missing, unknown or reused piece
    used.add(raw);
    slots.push(raw);
  }
  return slots;
}

// Reads the player's response from a form post. null means missing or malformed; never throws.
// For match_pairs, `itemIds` carries the target ids (in board order) and `pieceIds` the piece ids.
export function parseGiven(mechanic: Mechanic, params: URLSearchParams, itemIds?: string[], pieceIds?: string[]): unknown | null {
  if (mechanic === 'put_in_order') return parseOrder(params, itemIds);
  if (mechanic === 'match_pairs') return parseMatch(params, itemIds, pieceIds);
  const r = params.get('r');
  if (r === null || r.length > MAX_INPUT || r.trim() === '') return null;
  switch (mechanic) {
    case 'true_false':
      return r === 'true' ? true : r === 'false' ? false : null;
    case 'number': {
      const n = Number(r);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return r; // multiple_choice, odd_one_out (an id), short_text, clue_reveal (text)
  }
}

// `stored` is the item's private answer; a malformed stored answer never matches.
export function checkAnswer(mechanic: Mechanic, stored: unknown, given: unknown): boolean {
  switch (mechanic) {
    case 'multiple_choice':
    case 'odd_one_out':
      return typeof stored === 'string' && given === stored;
    case 'true_false':
      return typeof stored === 'boolean' && given === stored;
    case 'short_text':
    case 'clue_reveal': {
      const list = accepted(stored);
      if (!list || typeof given !== 'string') return false;
      const g = normalise(given);
      return g !== '' && list.some((a) => normalise(a) === g);
    }
    case 'number': {
      if (!isRecord(stored) || typeof stored.value !== 'number' || typeof stored.tolerance !== 'number') return false;
      return typeof given === 'number' && Number.isFinite(given) && Math.abs(given - stored.value) <= stored.tolerance;
    }
    case 'put_in_order':
    case 'match_pairs':
      return Array.isArray(stored) && Array.isArray(given) && stored.length === given.length && stored.every((id, i) => id === given[i]);
  }
}

type Choice = { id: string; text: string };
const choices = (x: unknown): Choice[] => (Array.isArray(x) ? (x as Choice[]).filter((c) => isRecord(c)) : []);

// Human text for the correct answer. Call only after a result has been given.
export function describeAnswer(body: unknown, stored: unknown): string {
  const b = isRecord(body) ? body : {};
  const visual = isRecord(b.visual) ? b.visual : {};
  const match = isRecord(visual.match) ? visual.match : null;
  const all = [...choices(b.options), ...choices(b.items), ...choices(match?.pieces)];
  const text = (id: unknown) => all.find((c) => c.id === id)?.text ?? String(id);
  if (typeof stored === 'boolean') {
    // Fact-or-fiction games speak their own labels (wave 1): the stored boolean is the same,
    // the words the player sees are Fact / Make-Believe.
    if (visual.gameType === 'fact-or-fiction') return stored ? 'Fact' : 'Make-Believe';
    return stored ? 'True' : 'False';
  }
  if (typeof stored === 'string') return text(stored);
  if (Array.isArray(stored)) {
    // A match_pairs key reads as pairs ("B → bear") when the body carries the board; the target
    // order is the board's, the stored ids are the pieces placed on them.
    const targets = match && Array.isArray(match.targets) ? (match.targets as Choice[]) : [];
    if (targets.length === stored.length && targets.every((t) => isRecord(t))) {
      return stored.map((pieceId, i) => `${text(pieceId)} → ${targets[i].text}`).join('; ');
    }
    return stored.map(text).join(', ');
  }
  const list = accepted(stored);
  if (list && list.length > 0) return list[0];
  if (isRecord(stored) && typeof stored.value === 'number') return String(stored.value);
  return '';
}
