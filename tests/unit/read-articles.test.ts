// The on-device read-articles tracker (owner request, 20 Nov 2026): persistence shape, defensive
// parsing, capping, and exhaustion as proof — the article counterpart of seen-quizzes.test.ts.
import { describe, it, expect } from 'vitest';
import {
  READ_CAP,
  READ_KEY,
  clearRead,
  emptyRead,
  isExhausted,
  loadRead,
  markRead,
  parseRead,
  readIds,
  saveRead,
  type ReadStorage,
} from '@/lib/read/read-articles';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: ReadStorage = {
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
const deadStorage: ReadStorage = {
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

describe('parseRead', () => {
  it('reads a well-formed list and drops malformed entries', () => {
    const raw = JSON.stringify({
      entries: [
        { id: 'a', at: 1 },
        { id: 42, at: 2 },
        { id: 'b' },
        { id: 'c', at: 3 },
        'junk',
      ],
    });
    expect(parseRead(raw)).toEqual({ entries: [{ id: 'a', at: 1 }, { id: 'c', at: 3 }] });
  });
  it('treats garbage and absence as an empty list', () => {
    expect(parseRead(null)).toEqual(emptyRead());
    expect(parseRead('not json')).toEqual(emptyRead());
    expect(parseRead('{"entries":{}}')).toEqual(emptyRead());
  });
});

describe('load / save / clear', () => {
  it('round-trips through storage under the read key', () => {
    const { storage, map } = fakeStorage();
    saveRead(storage, markRead(emptyRead(), 'a', 10));
    expect(map.has(READ_KEY)).toBe(true);
    expect(readIds(loadRead(storage))).toEqual(new Set(['a']));
    clearRead(storage);
    expect(loadRead(storage)).toEqual(emptyRead());
  });
  it('never throws against dead storage', () => {
    expect(loadRead(deadStorage)).toEqual(emptyRead());
    expect(() => saveRead(deadStorage, emptyRead())).not.toThrow();
    expect(() => clearRead(deadStorage)).not.toThrow();
  });
});

describe('markRead', () => {
  it('de-duplicates: a repeat visit keeps the first entry', () => {
    const once = markRead(emptyRead(), 'a', 10);
    const twice = markRead(once, 'a', 99);
    expect(twice.entries).toEqual([{ id: 'a', at: 10 }]);
  });
  it('prunes the oldest readings beyond the cap', () => {
    let state = emptyRead();
    for (let n = 0; n < READ_CAP + 5; n++) state = markRead(state, `a${n}`, n);
    expect(state.entries.length).toBe(READ_CAP);
    expect(readIds(state).has('a0')).toBe(false);
    expect(readIds(state).has(`a${READ_CAP + 4}`)).toBe(true);
  });
});

describe('isExhausted', () => {
  it('is proof only when the whole pool is in hand and every candidate is read', () => {
    const read = new Set(['a', 'b']);
    expect(isExhausted(read, ['a', 'b'], 2)).toBe(true);
    expect(isExhausted(read, ['a', 'b'], 3)).toBe(false); // truncated pool proves nothing
    expect(isExhausted(read, ['a'], 1)).toBe(true); // the whole pool, all read
    expect(isExhausted(read, ['a', 'c'], 2)).toBe(false); // 'c' is unread
    expect(isExhausted(read, [], 0)).toBe(false);
  });
});
