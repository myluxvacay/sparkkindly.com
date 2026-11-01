import { describe, it, expect } from 'vitest';
import { wrapTitle, worldHex } from '@/lib/public/palette';

describe('wrapTitle', () => {
  it('wraps a long title within the line limit and ends with an ellipsis on overflow', () => {
    const title = Array.from({ length: 20 }, (_, i) => `word${i}abc`).join(' '); // well over 140 chars
    const lines = wrapTitle(title, 24, 3);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(24);
    expect(lines[2].endsWith('…')).toBe(true);
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
