import { createHash, randomBytes } from 'node:crypto';

// Agent keys look like skagt_<8 hex>_<48 hex>. Only the 8-hex prefix (to find the agent) and sha256 of the 48-hex
// secret are stored. The secret is random and long, so a plain hash is enough: there is nothing to brute-force.
const KEY_PATTERN = /^skagt_([0-9a-f]{8})_([0-9a-f]{48})$/;

export const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');

export function generateKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('hex');
  return { key: `skagt_${prefix}_${secret}`, prefix, hash: hashSecret(secret) };
}

export function parseKey(key: string): { prefix: string; secret: string } | null {
  const m = KEY_PATTERN.exec(key);
  return m ? { prefix: m[1], secret: m[2] } : null;
}
