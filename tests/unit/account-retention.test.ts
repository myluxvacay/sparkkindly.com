// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { purgeAccountData } from '@/lib/accounts/retention';
import { tick } from '@/worker/main';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-10T03:00:00Z');
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const emails = async () => (await db.query<{ email: string }>('SELECT email FROM accounts ORDER BY email')).rows.map((r) => r.email);
const n = async (t: string) => Number((await db.query<{ n: string }>(`SELECT count(*) n FROM ${t}`)).rows[0].n);

async function account(email: string, createdAgoMs: number, verified: boolean) {
  await signUp(db, { email, dateOfBirth: '1990-05-05', parentEmail: undefined }, NOW);
  await db.query('UPDATE accounts SET created_at = $2 WHERE email = $1', [email, ago(createdAgoMs).toISOString()]);
  if (verified) {
    await db.query('UPDATE accounts SET verified_at = $2 WHERE email = $1', [email, ago(createdAgoMs).toISOString()]);
  }
}

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM account_login_tokens');
  await db.query('DELETE FROM job_runs');
});

describe('purgeAccountData', () => {
  it('deletes unverified accounts older than 48 hours and never a verified one, however old', async () => {
    await account('old-unverified@example.test', 49 * HOUR, false);
    await account('fresh-unverified@example.test', 47 * HOUR, false);
    await account('old-verified@example.test', 400 * 24 * HOUR, true);
    const r = await purgeAccountData(db, NOW);
    expect(await emails()).toEqual(['fresh-unverified@example.test', 'old-verified@example.test']);
    expect(r.accounts).toBe(1);
  });

  it('deletes expired tokens and used tokens older than a day; keeps live ones', async () => {
    await account('t@example.test', HOUR, true);
    const live = (await requestAccountLink(db, 't@example.test', {}, ago(5 * 60_000)))!;
    await requestAccountLink(db, 't@example.test', {}, ago(20 * 60_000)); // expired 5 minutes ago
    const used = (await requestAccountLink(db, 't@example.test', {}, ago(30 * HOUR)))!;
    await consumeAccountLink(db, used, ago(30 * HOUR));
    expect(await n('account_login_tokens')).toBe(3);
    const r = await purgeAccountData(db, NOW);
    expect(r.tokens).toBe(2);
    expect(await n('account_login_tokens')).toBe(1);
    expect(await consumeAccountLink(db, live, NOW)).not.toBeNull();
  });

  it('deletes expired sessions and keeps live ones', async () => {
    await account('s@example.test', 10 * 24 * HOUR, true);
    const stale = (await consumeAccountLink(db, (await requestAccountLink(db, 's@example.test', {}, ago(40 * 24 * HOUR)))!, ago(40 * 24 * HOUR)))!;
    const live = (await consumeAccountLink(db, (await requestAccountLink(db, 's@example.test', {}, ago(HOUR)))!, ago(HOUR)))!;
    expect(stale && live).toBeTruthy();
    const r = await purgeAccountData(db, NOW);
    expect(r.sessions).toBe(1);
    expect(await n('account_sessions')).toBe(1);
  });

  it('an old unverified account takes its sessions with it (cascade)', async () => {
    await account('ghost@example.test', 72 * HOUR, false);
    const id = (await db.query<{ id: string }>("SELECT id FROM accounts WHERE email = 'ghost@example.test'")).rows[0].id;
    await db.query(
      'INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at, last_seen_at) VALUES ($1, $2, $3, $4, $3)',
      ['f'.repeat(64), id, ago(HOUR).toISOString(), new Date(NOW.getTime() + 24 * HOUR).toISOString()],
    );
    const r = await purgeAccountData(db, NOW);
    expect(r).toMatchObject({ accounts: 1, sessions: 0 });
    expect(await n('account_sessions')).toBe(0);
  });

  it('a sign-up that replaces an old unverified row restarts its 48 hours, so its new link survives the purge', async () => {
    await account('again@example.test', 50 * HOUR, false);
    await signUp(db, { email: 'again@example.test', dateOfBirth: '1985-01-01' }, NOW);
    const link = (await requestAccountLink(db, 'again@example.test', {}, NOW))!;
    await purgeAccountData(db, NOW);
    expect(await emails()).toEqual(['again@example.test']);
    expect(await consumeAccountLink(db, link, NOW)).not.toBeNull();
  });

  it('is idempotent: a second run deletes nothing more', async () => {
    await account('old-unverified@example.test', 72 * HOUR, false);
    await account('kept@example.test', 72 * HOUR, true);
    await purgeAccountData(db, NOW);
    expect(await purgeAccountData(db, NOW)).toEqual({ accounts: 0, tokens: 0, sessions: 0 });
    expect(await emails()).toEqual(['kept@example.test']);
  });
});

describe('worker tick', () => {
  it('runs the account purge once per UTC day', async () => {
    const env = { DIGEST_HOUR_UTC: '23' };
    const send = vi.fn(async () => undefined);
    await account('gone@example.test', 72 * HOUR, false);
    expect((await tick(db, NOW, env, send, { delayMs: 0 })).join(';')).toMatch(/account purge: 1 account/);
    expect(await emails()).toEqual([]);
    await account('later@example.test', 72 * HOUR, false);
    expect((await tick(db, new Date(NOW.getTime() + 60_000), env, send, { delayMs: 0 })).join(';')).toMatch(
      /account purge: done today/,
    );
    expect(await emails()).toEqual(['later@example.test']);
    const tomorrow = new Date(NOW.getTime() + 24 * HOUR);
    expect((await tick(db, tomorrow, env, send, { delayMs: 0 })).join(';')).toMatch(/account purge: 1 account/);
    expect(await emails()).toEqual([]);
  });
});
