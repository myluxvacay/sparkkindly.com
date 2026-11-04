// @vitest-environment node
// Recording a signed-in profile's answer from the play panel (plan 3D, Task 3): only on a same-origin, non-prefetch
// request; the owner and the scope come from one server-side session lookup; only contexts allowed to save answers
// store anything; a recording failure never changes what the visitor sees.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { signUp } from '@/lib/accounts/signup';
import { requestAccountLink, consumeAccountLink } from '@/lib/accounts/sessions';
import { createChildProfile } from '@/lib/accounts/children';
import { switchToProfile } from '@/lib/accounts/context';
import { viewerForSession } from '@/lib/accounts/scope';
import { recordableRequest, recordPlay } from '@/lib/accounts/record-play';
import { playResult } from '@/lib/play/answer';
import type { Db } from '@/lib/db';
import { newToken } from '@/lib/tokens';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const env = { ADMIN_EMAILS: 'nobody@example.test' };
const ANON = ['kids', 'all', 'adults'];
let n = 0;

async function put(slug: string, audience: string) {
  const w = await db.query<{ id: number }>("SELECT id FROM worlds WHERE slug = 'play'");
  const body = { mechanic: 'multiple_choice', prompt: 'Which?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] };
  const r = await db.query<{ id: string }>(
    `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
     VALUES ($1,'quiz',$2,'T','S',$3::jsonb,$4,'published','2026-10-31T00:00:00Z','test','computable','test') RETURNING id`,
    [w.rows[0].id, slug, JSON.stringify(body), audience],
  );
  await db.query("INSERT INTO item_answers (item_id, answer, explanation) VALUES ($1, '\"b\"'::jsonb, 'Because.')", [r.rows[0].id]);
  return r.rows[0].id;
}

async function signIn(dateOfBirth: string, parentEmail?: string) {
  const email = `p${n++}@example.test`;
  const r = await signUp(db, { email, dateOfBirth, parentEmail }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  const session = (await consumeAccountLink(db, (await requestAccountLink(db, email, env, T0))!, T0))!;
  return { accountId: r.accountId, session };
}

async function childSession() {
  const { accountId, session } = await signIn('1985-01-01');
  const p = await createChildProfile(db, accountId, { displayName: 'Mia', ageBand: '6-9', guardianConfirmed: 'on', pin: '4826' }, T0);
  if (p.status !== 'created') throw new Error('profile not created');
  expect(await switchToProfile(db, session, p.profileId, T0)).toBe(true);
  return { accountId, profileId: p.profileId, session };
}

const rowsFor = async (accountId: string) =>
  (
    await db.query<{ profile_id: string | null; item_id: string; correct: boolean }>(
      'SELECT profile_id, item_id, correct FROM item_responses WHERE account_id = $1',
      [accountId],
    )
  ).rows;

// What the play panel does: the scope and the owner from one session lookup, then check, then record.
async function answer(session: string | undefined, slug: string, r: string, recordable = true) {
  const viewer = await viewerForSession(db, session, T0);
  const result = await playResult(db, viewer.scope, 'play', slug, new URLSearchParams({ r }));
  const note = await recordPlay(db, viewer.owner, result, recordable, T0);
  return { ...result, note };
}

let allItem: string;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  allItem = await put('for-all', 'all');
  await put('for-adults', 'adults');
});
afterAll(async () => {
  await db.close();
});

describe('recordableRequest', () => {
  const h = (o: Record<string, string>) => new Headers(o);

  it('only a same-origin request (a form submit from our own page) is recordable', () => {
    expect(recordableRequest(h({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    for (const v of ['none', 'cross-site', 'same-site', 'Same-Origin', 'same-origin, cross-site', '']) {
      expect(recordableRequest(h({ 'sec-fetch-site': v })), v).toBe(false);
    }
    expect(recordableRequest(h({}))).toBe(false);
  });

  it('a prefetch or prerender is never recordable, even same-origin', () => {
    for (const [k, v] of [
      ['sec-purpose', 'prefetch'],
      ['sec-purpose', 'prefetch;prerender'],
      ['purpose', 'prefetch'],
      ['purpose', 'Prefetch'],
      ['x-moz', 'prefetch'],
      ['next-router-prefetch', '1'],
    ]) {
      expect(recordableRequest(h({ 'sec-fetch-site': 'same-origin', [k]: v })), `${k}: ${v}`).toBe(false);
    }
  });
});

describe('viewerForSession', () => {
  it('no cookie, a garbage or unknown token: anonymous scope, no owner, database not asked', async () => {
    const query = vi.fn(async () => Promise.reject(new Error('down')));
    for (const t of [undefined, '', 'nope']) {
      const v = await viewerForSession({ query } as unknown as Db, t, T0);
      expect([...v.scope.audiences]).toEqual(ANON);
      expect(v.owner).toBeNull();
    }
    expect(query).not.toHaveBeenCalled();
    const v = await viewerForSession(db, newToken(), T0);
    expect([...v.scope.audiences]).toEqual(ANON);
    expect(v.owner).toBeNull();
  });

  it('an adult owns as the account holder (profile null)', async () => {
    const { accountId, session } = await signIn('1990-01-01');
    expect((await viewerForSession(db, session, T0)).owner).toEqual({ accountId, profileId: null });
  });

  it('a child context owns as its profile and sees kids and all only', async () => {
    const { accountId, profileId, session } = await childSession();
    const v = await viewerForSession(db, session, T0);
    expect(v.owner).toEqual({ accountId, profileId });
    expect([...v.scope.audiences]).toEqual(['kids', 'all']);
  });

  it('a consent-pending 13-15 account has no owner; once confirmed it has one', async () => {
    const { accountId, session } = await signIn('2012-01-01', 'parent@example.test');
    expect((await viewerForSession(db, session, T0)).owner).toBeNull();
    await db.query("UPDATE accounts SET consent_state = 'confirmed' WHERE id = $1", [accountId]);
    expect((await viewerForSession(db, session, T0)).owner).toEqual({ accountId, profileId: null });
  });

  it('a lookup that throws fails closed: child audiences, no owner, error name only', async () => {
    const err = Object.assign(new Error('ECONNREFUSED password=hunter2'), { name: 'DbDownError' });
    const broken = { query: async () => Promise.reject(err) } as unknown as Db;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const v = await viewerForSession(broken, newToken(), T0);
      expect([...v.scope.audiences]).toEqual(['kids', 'all']);
      expect(v.owner).toBeNull();
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/ECONNREFUSED|hunter2/);
    } finally {
      log.mockRestore();
    }
  });
});

describe('recordPlay', () => {
  it('an adult answer stores one row for the account, profile null; a second answer is ignored', async () => {
    const { accountId, session } = await signIn('1990-01-01');
    expect(await answer(session, 'for-all', 'b')).toMatchObject({ status: 'ok', correct: true, itemId: allItem, note: 'saved' });
    // The first answer is saved, so a repeat may say so too; it cannot change correctness.
    expect(await answer(session, 'for-all', 'a')).toMatchObject({ status: 'ok', correct: false, note: 'saved' });
    expect(await rowsFor(accountId)).toEqual([{ profile_id: null, item_id: allItem, correct: true }]);
  });

  it('a child context answer stores for its profile id', async () => {
    const { accountId, profileId, session } = await childSession();
    expect((await answer(session, 'for-all', 'a')).note).toBe('saved');
    expect(await rowsFor(accountId)).toEqual([{ profile_id: profileId, item_id: allItem, correct: false }]);
  });

  it('an adults item answered from a child context is not found and stores nothing', async () => {
    const { accountId, session } = await childSession();
    expect(await answer(session, 'for-adults', 'b')).toEqual({ status: 'not_found', note: 'unsaved' });
    expect(await rowsFor(accountId)).toEqual([]);
  });

  it('a consent-pending 13-15 account stores nothing but still sees the verdict', async () => {
    const { accountId, session } = await signIn('2012-01-01', 'parent@example.test');
    expect(await answer(session, 'for-all', 'b')).toMatchObject({ status: 'ok', correct: true, note: 'anonymous' });
    expect(await rowsFor(accountId)).toEqual([]);
  });

  it('a request that is not recordable (a link, a prefetch) stores nothing and says it was not saved this time', async () => {
    const { accountId, session } = await signIn('1990-01-01');
    expect(await answer(session, 'for-all', 'b', false)).toMatchObject({ status: 'ok', correct: true, note: 'unsaved' });
    expect(await rowsFor(accountId)).toEqual([]);
  });

  it('anonymous stores nothing and never touches the database for recording', async () => {
    const query = vi.fn();
    const result = await playResult(db, (await viewerForSession(db, undefined, T0)).scope, 'play', 'for-all', new URLSearchParams({ r: 'b' }));
    expect(await recordPlay({ query } as unknown as Db, null, result, true, T0)).toBe('anonymous');
    expect(await recordPlay({ query } as unknown as Db, null, null, true, T0)).toBe('anonymous');
    expect(query).not.toHaveBeenCalled();
  });

  it('before an answer, an invalid answer or a not-found result store nothing', async () => {
    const query = vi.fn();
    const owner = { accountId: crypto.randomUUID(), profileId: null };
    expect(await recordPlay({ query } as unknown as Db, owner, null, true, T0)).toBe('before');
    expect(await recordPlay({ query } as unknown as Db, owner, { status: 'invalid' }, true, T0)).toBe('before');
    expect(await recordPlay({ query } as unknown as Db, owner, { status: 'not_found' }, true, T0)).toBe('unsaved');
    expect(query).not.toHaveBeenCalled();
  });

  it('a recording error is swallowed, logs the error name only, leaves the result unchanged and never claims saved', async () => {
    const { accountId, session } = await signIn('1990-01-01');
    const viewer = await viewerForSession(db, session, T0);
    const result = await playResult(db, viewer.scope, 'play', 'for-all', new URLSearchParams({ r: 'b' }));
    const before = structuredClone(result);
    const err = Object.assign(new Error(`insert failed for ${accountId} ${allItem}`), { name: 'DbDownError', code: '08006' });
    const broken = { query: async () => Promise.reject(err) } as unknown as Db;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(recordPlay(broken, viewer.owner, result, true, T0)).resolves.toBe('unsaved');
      expect(result).toEqual(before);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]).toEqual(['answer recording failed:', 'DbDownError']);
      expect(JSON.stringify(log.mock.calls)).not.toContain(accountId);
      expect(JSON.stringify(log.mock.calls)).not.toContain(allItem);
    } finally {
      log.mockRestore();
    }
  });
});
