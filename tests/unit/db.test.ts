// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getPool } from '@/lib/db';

describe('getPool', () => {
  it('returns one shared pool', () => {
    expect(getPool()).toBe(getPool());
  });

  it('has an error listener, because an unhandled idle-client error would crash the process', () => {
    expect(getPool().listenerCount('error')).toBeGreaterThan(0);
  });
});
