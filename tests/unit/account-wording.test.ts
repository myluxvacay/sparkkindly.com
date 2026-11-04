import { describe, it, expect } from 'vitest';
import { maskEmail } from '@/lib/accounts/wording';

describe('maskEmail', () => {
  it('keeps the first character and the domain, hides the rest (fixed length, so it does not leak the length)', () => {
    expect(maskEmail('guardian@example.test')).toBe('g•••@example.test');
    expect(maskEmail('p@example.test')).toBe('p•••@example.test');
  });

  it('never returns the full address, and masks a value without an @ completely', () => {
    expect(maskEmail('guardian@example.test')).not.toContain('guardian');
    expect(maskEmail('nonsense')).toBe('•••');
  });
});
