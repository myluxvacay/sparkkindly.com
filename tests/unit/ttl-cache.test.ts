import { describe, it, expect, vi } from 'vitest';
import { memoizeFor } from '@/lib/ttl-cache';

describe('memoizeFor', () => {
  it('runs the function once within the window, sharing one in-flight call', async () => {
    let t = 0;
    const fn = vi.fn(async () => 'v');
    const cached = memoizeFor(5000, fn, () => t);
    const [a, b] = await Promise.all([cached(), cached()]);
    t = 4999;
    await cached();
    expect([a, b]).toEqual(['v', 'v']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs the function again once the window has passed', async () => {
    let t = 0;
    const fn = vi.fn(async () => 'v');
    const cached = memoizeFor(5000, fn, () => t);
    await cached();
    t = 5000;
    await cached();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('caches a rejection for the window too, so a failing dependency is not hammered', async () => {
    const fn = vi.fn(async () => {
      throw new Error('down');
    });
    const cached = memoizeFor(5000, fn, () => 0);
    await expect(cached()).rejects.toThrow('down');
    await expect(cached()).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
