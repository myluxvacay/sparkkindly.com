// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { getSettings, saveSettings } from '@/lib/accounts/settings';
import {
  applyUnsubscribe,
  readUnsubscribeToken,
  unsubscribeSecret,
  unsubscribeToken,
} from '@/lib/accounts/unsubscribe';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const SECRET = 'test-unsubscribe-secret-0123456789abcdef';
const OTHER = 'another-unsubscribe-secret-0123456789abcd';
const ID = '11111111-2222-4333-8444-555555555555';
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM accounts');
});

async function adult(): Promise<string> {
  const r = await signUp(db, { email: `u${n++}@example.test`, dateOfBirth: '1990-05-05' }, T0);
  if (r.status !== 'created') {
    throw new Error('sign-up failed');
  }
  return r.accountId;
}

describe('unsubscribe tokens', () => {
  it('round-trips the account id and kind', () => {
    for (const kind of ['daily_set', 'weekly_circle', 'invites'] as const) {
      const t = unsubscribeToken(SECRET, ID, kind) as string;
      expect(t).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(readUnsubscribeToken(SECRET, t)).toEqual({ accountId: ID, kind });
    }
  });

  it('refuses to mint or read without a usable secret', () => {
    expect(unsubscribeToken('', ID, 'invites')).toBeNull();
    expect(unsubscribeToken('short', ID, 'invites')).toBeNull();
    const t = unsubscribeToken(SECRET, ID, 'invites') as string;
    expect(readUnsubscribeToken('', t)).toBeNull();
  });

  it('reads the secret from UNSUBSCRIBE_SECRET and has no default', () => {
    expect(unsubscribeSecret({ UNSUBSCRIBE_SECRET: SECRET })).toBe(SECRET);
    expect(unsubscribeSecret({})).toBe('');
    expect(unsubscribeToken(unsubscribeSecret({}), ID, 'invites')).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const t = unsubscribeToken(OTHER, ID, 'invites') as string;
    expect(readUnsubscribeToken(SECRET, t)).toBeNull();
  });

  it('rejects tampered tokens: changed account, changed kind, changed signature, garbage', () => {
    const t = unsubscribeToken(SECRET, ID, 'daily_set') as string;
    const [, , sig] = t.split('.');
    const other = '99999999-2222-4333-8444-555555555555';
    expect(readUnsubscribeToken(SECRET, `${other}.daily_set.${sig}`)).toBeNull();
    expect(readUnsubscribeToken(SECRET, `${ID}.invites.${sig}`)).toBeNull();
    expect(readUnsubscribeToken(SECRET, `${ID}.daily_set.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(readUnsubscribeToken(SECRET, `${ID}.daily_set.${sig.slice(0, 10)}`)).toBeNull();
    expect(readUnsubscribeToken(SECRET, `${ID}.daily_set`)).toBeNull();
    expect(readUnsubscribeToken(SECRET, `${t}.extra`)).toBeNull();
    expect(readUnsubscribeToken(SECRET, '')).toBeNull();
    expect(readUnsubscribeToken(SECRET, 42 as unknown as string)).toBeNull();
  });

  it('refuses a non-canonical signature that decodes to the same bytes', () => {
    const t = unsubscribeToken(SECRET, ID, 'invites') as string;
    const sig = t.split('.')[2];
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // 43 characters carry 258 bits for a 256-bit MAC: the last character's 2 low bits are ignored by the decoder.
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const flipped = sig.slice(0, -1) + ALPHABET[ALPHABET.indexOf(sig.at(-1) as string) ^ 1];
    expect(Buffer.from(flipped, 'base64url')).toEqual(Buffer.from(sig, 'base64url'));
    for (const bad of [flipped, `${sig}=`, sig.replaceAll('-', '+').replaceAll('_', '/'), ` ${sig}`]) {
      if (bad === sig) continue;
      expect(readUnsubscribeToken(SECRET, `${ID}.invites.${bad}`), bad).toBeNull();
    }
  });

  it('a token for a kind outside the list is refused', () => {
    expect(unsubscribeToken(SECRET, ID, 'marketing' as 'invites')).toBeNull();
    expect(unsubscribeToken(SECRET, 'not-a-uuid', 'invites')).toBeNull();
  });
});

describe('applyUnsubscribe', () => {
  it('turns off only the token kind, for only that account', async () => {
    const a = await adult();
    const b = await adult();
    const all = { dailySet: true, weeklyCircle: true, invites: true };
    await saveSettings(db, a, { notify: all });
    await saveSettings(db, b, { notify: all });
    const read = readUnsubscribeToken(SECRET, unsubscribeToken(SECRET, a, 'weekly_circle') as string);
    expect(read).not.toBeNull();
    expect(await applyUnsubscribe(db, read!.accountId, read!.kind)).toBe(true);
    expect((await getSettings(db, a))?.notify).toEqual({ dailySet: true, weeklyCircle: false, invites: true });
    expect((await getSettings(db, b))?.notify).toEqual(all);
  });

  it('is false for a deleted account or a bad kind', async () => {
    expect(await applyUnsubscribe(db, ID, 'invites')).toBe(false);
    const a = await adult();
    expect(await applyUnsubscribe(db, a, 'marketing' as 'invites')).toBe(false);
    expect(await applyUnsubscribe(db, 'nope', 'invites')).toBe(false);
  });
});
