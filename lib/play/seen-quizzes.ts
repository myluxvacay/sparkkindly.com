import type { Difficulty } from '@/lib/public/body';

// The on-device "seen questions" memory (owner request, 17 Nov 2026): so the keep-playing choices
// never deal the same question twice, the browser remembers which quizzes it has been shown — no
// account, nothing sent to the server, no identifier of any kind. The list lives in local storage
// under SEEN_KEY; where storage is unavailable (private mode, storage off) the play island falls back
// to session storage and then to memory for the page's lifetime, so play never breaks.
//
// This module is the pure core: parsing is defensive (any malformed value reads as an empty list),
// marking is de-duplicated and capped, and exhaustion is a proof, not a guess — a level counts as
// exhausted only when every candidate is seen AND the candidates in hand are the whole pool.

export const SEEN_KEY = 'sk-seen-quizzes';
export const SEEN_CAP = 2000; // the library holds ~480 quizzes today; this is headroom, not a quota

export type SeenEntry = { id: string; level: Difficulty; at: number };
export type SeenState = { entries: SeenEntry[] };
export type SeenStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const LEVELS: readonly string[] = ['easy', 'medium', 'hard'];
const isLevel = (x: unknown): x is Difficulty => typeof x === 'string' && LEVELS.includes(x);

export const emptySeen = (): SeenState => ({ entries: [] });

export function parseSeen(raw: string | null): SeenState {
  if (!raw) return emptySeen();
  try {
    const parsed = JSON.parse(raw) as { entries?: unknown };
    if (!parsed || !Array.isArray(parsed.entries)) return emptySeen();
    const entries: SeenEntry[] = [];
    for (const e of parsed.entries) {
      const entry = e as Partial<SeenEntry>;
      if (typeof entry.id === 'string' && entry.id && isLevel(entry.level) && typeof entry.at === 'number') {
        entries.push({ id: entry.id, level: entry.level, at: entry.at });
      }
    }
    return { entries };
  } catch {
    return emptySeen();
  }
}

export function loadSeen(storage: SeenStorage): SeenState {
  try {
    return parseSeen(storage.getItem(SEEN_KEY));
  } catch {
    return emptySeen();
  }
}

export function saveSeen(storage: SeenStorage, state: SeenState): void {
  try {
    storage.setItem(SEEN_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the in-memory state still serves this page; nothing may throw.
  }
}

export function clearSeen(storage: SeenStorage): void {
  try {
    storage.removeItem(SEEN_KEY);
  } catch {
    // Nothing to clear if storage itself is unreachable.
  }
}

// Record a quiz as seen. A repeat sighting keeps the first entry (the level a question was first met
// at is its home level). Beyond the cap, the oldest sightings are pruned first.
export function markSeen(state: SeenState, id: string, level: Difficulty, at: number, cap: number = SEEN_CAP): SeenState {
  if (state.entries.some((e) => e.id === id)) return state;
  const entries = [...state.entries, { id, level, at }];
  if (entries.length > cap) entries.sort((a, b) => a.at - b.at).splice(0, entries.length - cap);
  return { entries };
}

export function seenIds(state: SeenState): Set<string> {
  return new Set(state.entries.map((e) => e.id));
}

// The merged seen-set the keep-playing deal plays against: this device's memory ∪ (for a signed-in
// player) the account's saved-answer history, supplied by the server as the ids that matter.
export function mergeSeenIds(...sources: (Iterable<string> | ReadonlySet<string>)[]): Set<string> {
  const merged = new Set<string>();
  for (const source of sources) for (const id of source) merged.add(id);
  return merged;
}

// A level is exhausted only on proof: every candidate in hand is seen, and the candidates in hand are
// the level's whole pool (total). If the pool was truncated, "all seen" proves nothing — the caller
// cycles the level instead of declaring it finished.
export function isExhausted(seen: ReadonlySet<string>, candidateIds: string[], total: number): boolean {
  if (candidateIds.length === 0 || candidateIds.length < total) return false;
  return candidateIds.every((id) => seen.has(id));
}
