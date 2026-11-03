import { afterEach, describe, expect, it, vi } from 'vitest';

async function postalAddress(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.CONTACT_ADDRESS;
  else process.env.CONTACT_ADDRESS = value;
  return (await import('../../lib/config')).site.postalAddress;
}

describe('site.postalAddress', () => {
  afterEach(() => {
    delete process.env.CONTACT_ADDRESS;
  });

  it('is null when CONTACT_ADDRESS is unset or blank', async () => {
    expect(await postalAddress(undefined)).toBeNull();
    expect(await postalAddress('   ')).toBeNull();
  });

  it('returns the trimmed single-line address', async () => {
    expect(await postalAddress('  1 Example St, Town ST 00000  ')).toBe('1 Example St, Town ST 00000');
  });

  it('collapses line breaks and ignores an over-long value', async () => {
    expect(await postalAddress('1 Example St\n<b>Town</b>')).toBe('1 Example St <b>Town</b>');
    expect(await postalAddress('x'.repeat(201))).toBeNull();
  });
});
