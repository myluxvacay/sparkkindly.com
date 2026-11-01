import { createHmac, randomBytes } from 'node:crypto';

// Time-based one-time codes (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), the format every authenticator app reads.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 160 random bits, the size RFC 4226 recommends.
export const newTotpSecret = (): string => base32Encode(randomBytes(20));

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const n = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(n % 1_000_000).padStart(6, '0');
}

// Returns the matched step when `code` is right for the current step or one either side (clock drift) and that step is
// later than the last one used, else null. Comparing every candidate keeps the timing the same whichever matched.
export function matchTotp(secret: string, code: string, now: Date, lastStep: number): number | null {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now.getTime() / STEP_MS);
  let found: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (totpAt(secret, step) === code && step > lastStep && found === null) found = step;
  }
  return found;
}

export function otpauthUri(email: string, secret: string): string {
  return `otpauth://totp/SparkKindly:${encodeURIComponent(email)}?secret=${secret}&issuer=SparkKindly&algorithm=SHA1&digits=6&period=30`;
}
