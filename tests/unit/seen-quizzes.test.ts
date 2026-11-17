// The on-device seen-questions tracker (owner request, 17 Nov 2026): persistence shape, defensive
// parsing, capping, the merged seen-set (device ∪ account history), and exhaustion as proof.
import { describe, it, expect } from 'vitest';
import {
  SEEN_CAP,
  SEEN_KEY,
  clearSeen,
  emptySeen,
  isExhausted,
  loadSeen,
  markSeen,
  mergeSeenIds,
  parseSeen,
  saveSeen,
  seenIds,
  type SeenStorage,
} from '@/lib/play/seen-quizzes';
import { pickCandidate } from '@/lib/play/keep-playing';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: SeenStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
  return { storage, map };
}
const deadStorage: SeenStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('parseSeen / loadSeen', () => {
  it('reads back only well-formed entries; anything malformed is an empty list, never a throw', () => {
    expect(parseSeen(null)).toEqual({ entries: [] });
    expect(parseSeen('not json')).toEqual({ entries: [] });
    expect(parseSeen('{"entries":"nope"}')).toEqual({ entries: [] });
    const mixed = JSON.stringify({
      entries: [
        { id: 'a', level: 'easy', at: 5 },
        { id: 42, level: 'easy', at: 5 },
        { id: 'b', level: 'extreme', at: 5 },
        { id: 'c', level: 'hard', at: 'soon' },
        { id: 'd', level: 'medium', at: 9 },
      ],
    });
    expect(parseSeen(mixed)).toEqual({
      entries: [
        { id: 'a', level: 'easy', at: 5 },
        { id: 'd', level: 'medium', at: 9 },
      ],
    });
    expect(loadSeen(deadStorage)).toEqual({ entries: [] });
  });
});

describe('markSeen / save / load round-trip', () => {
  it('persists across "sessions": a fresh load from stored state still excludes what was seen', () => {
    const { storage } = fakeStorage();
    let state = emptySeen();
    state = markSeen(state, 'q1', 'easy', 100);
    state = markSeen(state, 'q2', 'medium', 200);
    saveSeen(storage, state);

    // A later visit: brand-new in-memory state, loaded from storage alone.
    const reloaded = loadSeen(storage);
    expect(seenIds(reloaded)).toEqual(new Set(['q1', 'q2']));
    const candidates = [
      { id: 'q1', href: '/play/q1/' },
      { id: 'q3', href: '/play/q3/' },
    ];
    expect(pickCandidate(candidates, seenIds(reloaded))?.candidate.id).toBe('q3');
  });

  it('de-duplicates by id and prunes the oldest beyond the cap', () => {
    let state = emptySeen();
    state = markSeen(state, 'a', 'easy', 1, 3);
    state = markSeen(state, 'a', 'easy', 2, 3); // repeat sighting: no second entry
    expect(state.entries).toHaveLength(1);
    state = markSeen(state, 'b', 'easy', 2, 3);
    state = markSeen(state, 'c', 'easy', 3, 3);
    state = markSeen(state, 'd', 'easy', 4, 3); // over cap: 'a' (oldest) is pruned
    expect(state.entries.map((e) => e.id)).toEqual(['b', 'c', 'd']);
    expect(SEEN_CAP).toBe(2000);
  });

  it('clearSeen removes the stored list; a dead storage never throws anywhere', () => {
    const { storage, map } = fakeStorage();
    saveSeen(storage, markSeen(emptySeen(), 'x', 'hard', 1));
    expect(map.has(SEEN_KEY)).toBe(true);
    clearSeen(storage);
    expect(map.has(SEEN_KEY)).toBe(false);
    expect(() => saveSeen(deadStorage, emptySeen())).not.toThrow();
    expect(() => clearSeen(deadStorage)).not.toThrow();
  });
});

describe('mergeSeenIds + isExhausted', () => {
  it('merges the device list with the account history into one exclusion set', () => {
    const device = new Set(['a', 'b']);
    const account = ['b', 'c'];
    expect(mergeSeenIds(device, account)).toEqual(new Set(['a', 'b', 'c']));
    expect(mergeSeenIds(device)).toEqual(device);
  });

  it('a level is exhausted only when every candidate is seen AND the pool in hand is the whole pool', () => {
    const seen = new Set(['a', 'b', 'c']);
    expect(isExhausted(seen, ['a', 'b'], 2)).toBe(true); // whole level seen
    expect(isExhausted(seen, ['a', 'b'], 5)).toBe(false); // truncated pool: unproven
    expect(isExhausted(seen, ['a', 'z'], 2)).toBe(false); // one unseen remains
    expect(isExhausted(seen, [], 0)).toBe(false); // nothing in hand proves nothing
  });

  it('signed-in exhaustion against account history: account ∪ device can finish a level neither finishes alone', () => {
    const level = ['q1', 'q2', 'q3', 'q4'];
    const device = new Set(['q1', 'q2']);
    const account = ['q3', 'q4'];
    expect(isExhausted(device, level, level.length)).toBe(false);
    expect(isExhausted(new Set(account), level, level.length)).toBe(false);
    expect(isExhausted(mergeSeenIds(device, account), level, level.length)).toBe(true);
  });
});
