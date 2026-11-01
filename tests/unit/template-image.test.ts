import { describe, it, expect } from 'vitest';
import { plainTitle, wrapTitle, worldHex } from '@/lib/public/palette';
import { templateImage } from '@/lib/public/template-image';
import type { PublicItem } from '@/lib/items/repo';

describe('wrapTitle', () => {
  it('wraps a long title within the line limit and ends with an ASCII ellipsis on overflow', () => {
    const title = Array.from({ length: 20 }, (_, i) => `word${i}abc`).join(' '); // well over 140 chars
    const lines = wrapTitle(title, 24, 3);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(24);
    expect(lines[2].endsWith('...')).toBe(true);
  });

  it('keeps a short title whole, without an ellipsis', () => {
    expect(wrapTitle('A small title', 24, 3)).toEqual(['A small title']);
  });

  it('hard-splits a single word longer than the line', () => {
    const lines = wrapTitle('x'.repeat(60), 20, 5);
    expect(lines).toEqual(['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(20)]);
  });

  it('returns no lines for an empty or blank title', () => {
    expect(wrapTitle('', 20, 3)).toEqual([]);
    expect(wrapTitle('   ', 20, 3)).toEqual([]);
  });
});

describe('worldHex', () => {
  it('maps the world colour keys to the stylesheet hex values', () => {
    expect(worldHex('gold')).toBe('#f7c948');
    expect(worldHex('sage')).toBe('#6ea99f');
    expect(worldHex('coral')).toBe('#ff7a7a');
  });

  it('falls back to the brand plum for an unknown or missing key', () => {
    expect(worldHex('nope')).toBe('#5b2c6f');
    expect(worldHex('')).toBe('#5b2c6f');
  });
});

describe('plainTitle', () => {
  it('keeps Latin text and maps typographic punctuation to ASCII', () => {
    expect(plainTitle('Café “quoted” – it’s fine…')).toBe("Café \"quoted\" - it's fine...");
  });

  it('drops emoji and scripts the bundled font lacks, and collapses the gaps', () => {
    expect(plainTitle('☀ Shadow 日本語 explorers 🦊')).toBe('Shadow explorers');
  });
});

describe('templateImage', () => {
  it('renders a title with emoji and CJK without any outbound fetch', async () => {
    const real = globalThis.fetch;
    const outbound: string[] = [];
    // The renderer also tries a local fetch for its wasm and falls back, so only http(s) URLs count.
    globalThis.fetch = ((u: unknown) => {
      if (/^https?:/.test(String(u))) outbound.push(String(u));
      return Promise.reject(new Error('blocked'));
    }) as typeof fetch;
    try {
      const item = { title: '☀ Shadow 日本語 explorers 🦊 …', world: 'kids' } as PublicItem;
      const res = templateImage(item, { name: 'Kids', color: 'gold' });
      // Layout (where fonts and emoji are fetched) runs before rasterising; rasterising needs the real runtime, which
      // the e2e template-image test covers, so a failure after layout is not what this test is about.
      await res.arrayBuffer().catch(() => undefined);
      expect(outbound).toEqual([]);
    } finally {
      globalThis.fetch = real;
    }
  });
});
