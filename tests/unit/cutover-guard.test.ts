import { describe, expect, it } from 'vitest';
import { checkTarget, parseBound } from '@/lib/cutover/guard';

const LOAD = { allowed: ['staging.sparkkindly.com', 'localhost', '127.0.0.1'] };
const PROD_OK = { allowed: ['staging.sparkkindly.com', 'localhost', '127.0.0.1', 'sparkkindly.com'] };

describe('checkTarget', () => {
  it('allows staging over https and loopback over http', () => {
    expect(checkTarget('https://staging.sparkkindly.com', LOAD)).toMatchObject({ ok: true, authAllowed: true });
    expect(checkTarget('http://localhost:4173', LOAD)).toMatchObject({ ok: true, authAllowed: true });
    expect(checkTarget('http://127.0.0.1:3000', LOAD)).toMatchObject({ ok: true, authAllowed: true });
  });

  it('refuses production, with or without a trailing dot or capitals, unless the list includes it', () => {
    for (const u of ['https://sparkkindly.com', 'https://sparkkindly.com.', 'https://SparkKindly.com..', 'https://www.sparkkindly.com']) {
      expect(checkTarget(u, LOAD).ok, u).toBe(false);
    }
    expect(checkTarget('https://sparkkindly.com.', PROD_OK).ok).toBe(true);
  });

  it('refuses lookalikes and other hosts', () => {
    for (const u of ['https://staging.sparkkindly.com.evil.test', 'https://evil.test/staging.sparkkindly.com', 'https://myluxvacation.com',
      'https://user@staging.sparkkindly.com']) {
      expect(checkTarget(u, LOAD).ok, u).toBe(false);
    }
  });

  it('refuses IP literals other than the loopback address, including encodings that resolve to one', () => {
    for (const u of ['http://2.25.121.2', 'http://[::1]:3000', 'http://10.0.0.5', 'http://2.25.121.2.']) {
      expect(checkTarget(u, LOAD).ok, u).toBe(false);
    }
  });

  it('refuses a non-http scheme and garbage', () => {
    expect(checkTarget('ftp://localhost', LOAD).ok).toBe(false);
    expect(checkTarget('not a url', LOAD).ok).toBe(false);
  });

  it('sends Basic auth only over https or to loopback', () => {
    expect(checkTarget('http://staging.sparkkindly.com', LOAD)).toMatchObject({ ok: true, authAllowed: false });
    expect(checkTarget('https://staging.sparkkindly.com', LOAD)).toMatchObject({ authAllowed: true });
  });
});

describe('parseBound', () => {
  it('returns the default when absent and the number when valid', () => {
    expect(parseBound(undefined, 8, 1, 100)).toBe(8);
    expect(parseBound('20', 8, 1, 100)).toBe(20);
  });
  it('clamps to the range', () => {
    expect(parseBound('9999', 8, 1, 100)).toBe(100);
    expect(parseBound('0', 8, 1, 100)).toBe(1);
  });
  it('returns null for non-finite input', () => {
    for (const bad of ['abc', 'NaN', 'Infinity', '-Infinity', '', '1e999']) expect(parseBound(bad, 8, 1, 100), bad).toBeNull();
  });
});
