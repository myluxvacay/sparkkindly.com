// The on-device "read articles" memory (owner request, 20 Nov 2026): so the keep-reading choices
// prefer articles the reader has not finished yet, the browser remembers which articles it has been
// shown — no account, nothing sent to the server, no identifier of any kind. The list lives in local
// storage under READ_KEY; where storage is unavailable (private mode, storage off) the reading island
// falls back to session storage and then to memory for the page's lifetime, so reading never breaks.
//
// This is the article counterpart of lib/play/seen-quizzes.ts and follows it exactly, including the
// child-safety rule: the island only ever reads or writes this list on surfaces where tracking is
// allowed (never on Kids-audience items — see components/item/KeepReading and the page wiring). This
// module is the pure core: parsing is defensive (any malformed value reads as an empty list), marking
// is de-duplicated and capped, and exhaustion is a proof, not a guess — a shelf counts as exhausted
// only when every candidate is read AND the candidates in hand are the whole pool.

export const READ_KEY = 'sk-read-articles';
export const READ_CAP = 2000; // the library holds ~1,000 articles today; this is headroom, not a quota

export type ReadEntry = { id: string; at: number };
export type ReadState = { entries: ReadEntry[] };
export type ReadStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export const emptyRead = (): ReadState => ({ entries: [] });

export function parseRead(raw: string | null): ReadState {
  if (!raw) return emptyRead();
  try {
    const parsed = JSON.parse(raw) as { entries?: unknown };
    if (!parsed || !Array.isArray(parsed.entries)) return emptyRead();
    const entries: ReadEntry[] = [];
    for (const e of parsed.entries) {
      const entry = e as Partial<ReadEntry>;
      if (typeof entry.id === 'string' && entry.id && typeof entry.at === 'number') {
        entries.push({ id: entry.id, at: entry.at });
      }
    }
    return { entries };
  } catch {
    return emptyRead();
  }
}

export function loadRead(storage: ReadStorage): ReadState {
  try {
    return parseRead(storage.getItem(READ_KEY));
  } catch {
    return emptyRead();
  }
}

export function saveRead(storage: ReadStorage, state: ReadState): void {
  try {
    storage.setItem(READ_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the in-memory state still serves this page; nothing may throw.
  }
}

export function clearRead(storage: ReadStorage): void {
  try {
    storage.removeItem(READ_KEY);
  } catch {
    // Nothing to clear if storage itself is unreachable.
  }
}

// Record an article as read. A repeat visit keeps the first entry (the first finish is the one that
// counts for "have I read this"). Beyond the cap, the oldest readings are pruned first.
export function markRead(state: ReadState, id: string, at: number, cap: number = READ_CAP): ReadState {
  if (state.entries.some((e) => e.id === id)) return state;
  const entries = [...state.entries, { id, at }];
  if (entries.length > cap) entries.sort((a, b) => a.at - b.at).splice(0, entries.length - cap);
  return { entries };
}

export function readIds(state: ReadState): Set<string> {
  return new Set(state.entries.map((e) => e.id));
}

// A shelf is exhausted only on proof: every candidate in hand is read, and the candidates in hand are
// the shelf's whole pool (total). If the pool was truncated, "all read" proves nothing — the caller
// cycles the shelf instead of declaring it finished. (Same rule as seen-quizzes' isExhausted.)
export function isExhausted(read: ReadonlySet<string>, candidateIds: string[], total: number): boolean {
  if (candidateIds.length === 0 || candidateIds.length < total) return false;
  return candidateIds.every((id) => read.has(id));
}
