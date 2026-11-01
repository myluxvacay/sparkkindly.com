import { describe, expect, it } from 'vitest';
import { clueCount, hasResponse, toParams } from '@/lib/public/play-params';

describe('play params', () => {
  it('takes the first value of a repeated key and skips undefined', () => {
    expect(toParams({ r: ['a', 'b'], x: undefined, clues: '2' }).toString()).toBe('r=a&clues=2');
  });
  it('sees a response only when r or a pos- field is present', () => {
    expect(hasResponse(toParams({}))).toBe(false);
    expect(hasResponse(toParams({ clues: '2' }))).toBe(false);
    expect(hasResponse(toParams({ r: '' }))).toBe(true);
    expect(hasResponse(toParams({ 'pos-a': '1' }))).toBe(true);
  });
  it('clamps the clue count to 1..total', () => {
    const c = (v: string | undefined) => clueCount(toParams(v === undefined ? {} : { clues: v }), 4);
    expect([c(undefined), c('abc'), c('0'), c('-3'), c('2.5'), c('3'), c('99')]).toEqual([1, 1, 1, 1, 1, 3, 4]);
  });
});
