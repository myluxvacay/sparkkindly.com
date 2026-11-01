// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getPool, poolSize } from '@/lib/db';

describe('getPool', () => {
  it('returns one shared pool', () => {
    expect(getPool()).toBe(getPool());
  });

  it('has an error listener, because an unhandled idle-client error would crash the process', () => {
    expect(getPool().listenerCount('error')).toBeGreaterThan(0);
  });
});

describe('poolSize', () => {
  it.each([[undefined, 5], ['1', 1], ['8', 8], ['0', 5], ['-2', 5], ['abc', 5], ['2.5', 5], ['500', 20]])('%j gives %i', (raw, size) => {
    expect(poolSize(raw)).toBe(size);
  });
});
