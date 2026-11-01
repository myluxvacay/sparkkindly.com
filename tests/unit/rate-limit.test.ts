import { describe, it, expect } from 'vitest';
import { createLimiter } from '@/lib/agents/rate-limit';

describe('createLimiter', () => {
  it('allows the first 60 requests in a minute and limits the 61st', () => {
    const t = 0;
    const allow = createLimiter({ perMinute: 60, now: () => t });
    for (let i = 0; i < 60; i++) expect(allow('k'), `request ${i + 1}`).toBe(true);
    expect(allow('k')).toBe(false);
  });

  it('keeps a separate allowance per key', () => {
    const t = 0;
    const allow = createLimiter({ perMinute: 2, now: () => t });
    expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(false);
    expect(allow('b')).toBe(true);
  });

  it('refills over time', () => {
    let t = 0;
    const allow = createLimiter({ perMinute: 60, now: () => t });
    for (let i = 0; i < 60; i++) allow('k');
    expect(allow('k')).toBe(false);
    t += 1000; // one second refills one request
    expect(allow('k')).toBe(true);
    expect(allow('k')).toBe(false);
    t += 60_000;
    for (let i = 0; i < 60; i++) expect(allow('k')).toBe(true);
  });

  it('forgets idle keys so memory does not grow without bound', () => {
    let t = 0;
    const allow = createLimiter({ perMinute: 5, now: () => t });
    for (let i = 0; i < 1000; i++) allow(`key-${i}`);
    t += 10 * 60_000;
    allow('trigger-cleanup');
    expect(allow.size()).toBeLessThan(10);
  });
});
