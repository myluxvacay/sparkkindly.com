import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EnvLike } from '@/lib/env';

// Encryption at rest for authenticator secrets: AES-256-GCM with a 32-byte key from ADMIN_SECRET_KEY (base64, in the
// root-owned env file, read at run time, never committed). The admin's address is bound in as associated data, so a
// ciphertext copied to another row does not open. Stored as "v1:" + base64(iv | tag | ciphertext); the version prefix
// lets a later key or algorithm change sit alongside.

export class SecretKeyError extends Error {
  constructor() {
    super('ADMIN_SECRET_KEY must be set to a base64-encoded 32-byte key');
    this.name = 'SecretKeyError';
  }
}

// A fixed key for tests only. Never used by the app unless an env file sets it, which the docs forbid.
export const TEST_SECRET_KEY = Buffer.alloc(32, 1).toString('base64');

function keyFrom(env: EnvLike): Buffer {
  const raw = env.ADMIN_SECRET_KEY ?? '';
  const key = /^[A-Za-z0-9+/]+={0,2}$/.test(raw) ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) throw new SecretKeyError();
  return key;
}

export function sealSecret(plain: string, aad: string, env: EnvLike): string {
  const key = keyFrom(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

// The plaintext, or null when the key is missing or wrong, the value was tampered with or moved, or it is not sealed.
export function openSecret(sealed: string, aad: string, env: EnvLike): string | null {
  if (typeof sealed !== 'string' || !sealed.startsWith('v1:')) return null;
  try {
    const bytes = Buffer.from(sealed.slice(3), 'base64');
    if (bytes.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(env), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
