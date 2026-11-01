import { describe, it, expect } from 'vitest';
import { base32Decode, base32Encode, matchTotp, newTotpSecret, otpauthUri, totpAt } from '@/lib/admin/totp';

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890" with SHA-1; at T=59s the 8-digit code is 94287082.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('matches the RFC 6238 SHA-1 vectors (last six digits)', () => {
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(totpAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804');
  });

  it('round-trips base32 and makes 160-bit secrets', () => {
    const buf = Buffer.from('any bytes at all \u0000ÿ');
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(base32Decode(newTotpSecret())).toHaveLength(20);
    expect(newTotpSecret()).not.toBe(newTotpSecret());
  });

  it('accepts the previous and next step, not two steps away', () => {
    const now = new Date(1_800_000_000_000);
    const step = Math.floor(now.getTime() / 30_000);
    const s = newTotpSecret();
    expect(matchTotp(s, totpAt(s, step), now, 0)).toBe(step);
    expect(matchTotp(s, totpAt(s, step - 1), now, 0)).toBe(step - 1);
    expect(matchTotp(s, totpAt(s, step + 1), now, 0)).toBe(step + 1);
    expect(matchTotp(s, totpAt(s, step - 2), now, 0)).toBeNull();
    expect(matchTotp(s, totpAt(s, step + 2), now, 0)).toBeNull();
  });

  it('refuses a step at or before the last one used (replay)', () => {
    const now = new Date(1_800_000_000_000);
    const step = Math.floor(now.getTime() / 30_000);
    const s = newTotpSecret();
    expect(matchTotp(s, totpAt(s, step), now, step)).toBeNull();
    expect(matchTotp(s, totpAt(s, step - 1), now, step - 1)).toBeNull();
  });

  it('refuses malformed codes', () => {
    const s = newTotpSecret();
    const now = new Date();
    for (const bad of ['', '12345', '1234567', 'abcdef', ' 12345', '12 345', null, undefined, 123456]) {
      expect(matchTotp(s, bad as unknown as string, now, 0)).toBeNull();
    }
  });

  it('builds an otpauth URI with the issuer and the encoded account', () => {
    const uri = otpauthUri('owner+x@example.test', 'ABCDEF');
    expect(uri).toBe(
      'otpauth://totp/SparkKindly:owner%2Bx%40example.test?secret=ABCDEF&issuer=SparkKindly&algorithm=SHA1&digits=6&period=30',
    );
  });
});
