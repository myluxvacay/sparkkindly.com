import { describe, it, expect } from 'vitest';
import { assertSafeImportTarget } from '@/lib/items/import-guard';

describe('assertSafeImportTarget', () => {
  it('refuses the production database without the explicit flag', () => {
    expect(() => assertSafeImportTarget('sparkkindly', false)).toThrow(/production/i);
  });

  it('allows the production database only with the flag', () => {
    expect(() => assertSafeImportTarget('sparkkindly', true)).not.toThrow();
  });

  it('allows staging and local databases without the flag', () => {
    expect(() => assertSafeImportTarget('sparkkindly_staging', false)).not.toThrow();
    expect(() => assertSafeImportTarget('sparkkindly_test', false)).not.toThrow();
    expect(() => assertSafeImportTarget('scratch', false)).not.toThrow();
  });

  it('is not fooled by case or surrounding whitespace', () => {
    expect(() => assertSafeImportTarget(' SparkKindly ', false)).toThrow(/production/i);
  });
});
