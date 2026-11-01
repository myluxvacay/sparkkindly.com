import { describe, it, expect } from 'vitest';
import { openSecret, sealSecret, SecretKeyError, TEST_SECRET_KEY } from '@/lib/admin/secret-box';

const env = { ADMIN_SECRET_KEY: TEST_SECRET_KEY };

describe('secret box (AES-256-GCM, key from ADMIN_SECRET_KEY)', () => {
  it('round-trips and never repeats a ciphertext', () => {
    const a = sealSecret('JBSWY3DPEHPK3PXP', 'owner@example.test', env);
    const b = sealSecret('JBSWY3DPEHPK3PXP', 'owner@example.test', env);
    expect(a).toMatch(/^v1:[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(openSecret(a, 'owner@example.test', env)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('refuses a ciphertext moved to another address, tampered with, or opened with another key', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', 'owner@example.test', env);
    expect(openSecret(sealed, 'intruder@example.test', env)).toBeNull();
    const bytes = Buffer.from(sealed.slice(3), 'base64');
    bytes[bytes.length - 1] ^= 1;
    expect(openSecret(`v1:${bytes.toString('base64')}`, 'owner@example.test', env)).toBeNull();
    expect(openSecret(sealed, 'owner@example.test', { ADMIN_SECRET_KEY: Buffer.alloc(32, 9).toString('base64') })).toBeNull();
    expect(openSecret('JBSWY3DPEHPK3PXP', 'owner@example.test', env)).toBeNull();
  });

  it('fails closed without a valid 32-byte key', () => {
    for (const bad of [undefined, '', 'short', Buffer.alloc(16).toString('base64')]) {
      expect(() => sealSecret('x', 'a@example.test', { ADMIN_SECRET_KEY: bad })).toThrow(SecretKeyError);
      expect(openSecret(sealSecret('x', 'a@example.test', env), 'a@example.test', { ADMIN_SECRET_KEY: bad })).toBeNull();
    }
  });
});
