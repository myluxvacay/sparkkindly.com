// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import type { Queryable } from '@/lib/db';
import { signUp } from '@/lib/accounts/signup';
import { consumeAccountLink, requestAccountLink } from '@/lib/accounts/sessions';
import { confirmConsent, issueConsentTokens } from '@/lib/accounts/consent';
import { createChildProfile } from '@/lib/accounts/children';
import { setInterests } from '@/lib/accounts/interests';
import { recordAnswer } from '@/lib/accounts/responses';
import { saveSettings } from '@/lib/accounts/settings';
import { EXCLUDED_TABLES, EXPORTED_TABLES, exportAccount } from '@/lib/accounts/export';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const T1 = new Date('2026-11-02T09:30:00Z');
const NOW = new Date('2026-11-04T12:00:00Z');
let worlds: { id: number; slug: string }[] = [];
let topics: { id: number; slug: string; name: string }[] = [];
const items: { id: string; slug: string }[] = [];
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  worlds = (await db.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds ORDER BY id LIMIT 2')).rows;
  const t = await db.query<{ id: number; slug: string; name: string }>(
    'SELECT id, slug, name FROM topics ORDER BY id LIMIT 3',
  );
  topics = t.rows;
  for (const [i, slug] of ['exp-one', 'exp-two', 'exp-three'].entries()) {
    const r = await db.query<{ id: string }>(
      `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
       VALUES ($1,'quiz',$2,'T','S','{}'::jsonb,'all','published','2026-10-31T00:00:00Z','test','computable','test') RETURNING id`,
      [worlds[i % 2].id, slug],
    );
    items.push({ id: r.rows[0].id, slug });
  }
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM accounts');
});

async function signedIn(email: string, dateOfBirth: string, parentEmail?: string): Promise<string> {
  const r = await signUp(db, { email, dateOfBirth, parentEmail, timeZone: 'Europe/Paris' }, T0);
  if (r.status !== 'created') throw new Error('sign-up failed');
  await consumeAccountLink(db, (await requestAccountLink(db, email, {}, T0)) as string, T0);
  return r.accountId;
}
async function child(accountId: string, displayName: string, ageBand: '6-9' | '10-12'): Promise<string> {
  const c = await createChildProfile(db, accountId, { displayName, ageBand, guardianConfirmed: true, pin: '1234' }, T0);
  if (c.status !== 'created') throw new Error('profile failed');
  return c.profileId;
}

// An adult with interests and answers of their own and two child profiles with theirs.
async function family(email: string) {
  const id = await signedIn(email, '1985-03-04');
  await saveSettings(db, id, { notify: { dailySet: true } });
  const mia = await child(id, 'Mia', '6-9');
  const leo = await child(id, 'Leo', '10-12');
  await setInterests(db, { accountId: id, profileId: null }, { topicIds: [topics[0].id], worldIds: [worlds[0].id] });
  await setInterests(db, { accountId: id, profileId: mia }, { topicIds: [topics[1].id], worldIds: [] });
  await setInterests(db, { accountId: id, profileId: leo }, { topicIds: [], worldIds: [worlds[1].id] });
  await recordAnswer(db, { accountId: id, profileId: null }, items[0].id, true, T1);
  await recordAnswer(db, { accountId: id, profileId: mia }, items[1].id, false, T1);
  await recordAnswer(db, { accountId: id, profileId: leo }, items[2].id, true, T1);
  return { id, mia, leo };
}

// Personal-data tables as the database sees them: accounts, every account_* table, and every table with a foreign key
// to accounts. A new table in any of these shapes must be added to EXPORTED_TABLES or EXCLUDED_TABLES.
async function personalDataTables(q: Queryable): Promise<string[]> {
  const r = await q.query<{ t: string }>(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = 'public' AND (table_name = 'accounts' OR table_name LIKE 'account\\_%')
     UNION
     SELECT tc.table_name FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       AND ccu.constraint_schema = tc.constraint_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND ccu.table_name = 'accounts'`,
  );
  return r.rows.map((x) => x.t).sort();
}
const decided = () => [...EXPORTED_TABLES, ...Object.keys(EXCLUDED_TABLES)].sort();

describe('export inventory', () => {
  it('every personal-data table in the schema is either exported or excluded with a reason', async () => {
    expect(decided()).toEqual(await personalDataTables(db));
    expect([...EXPORTED_TABLES].sort()).toEqual(['accounts', 'child_profiles', 'item_responses', 'profile_interests']);
    for (const reason of Object.values(EXCLUDED_TABLES)) expect(reason.length).toBeGreaterThan(10);
  });

  it('includes the seven tables of the data inventory', () => {
    for (const t of [
      'accounts',
      'account_login_tokens',
      'account_sessions',
      'account_consent_tokens',
      'child_profiles',
      'profile_interests',
      'item_responses',
    ]) {
      expect(decided()).toContain(t);
    }
  });

  it('a new undecided personal-data table makes the comparison fail', async () => {
    await db.transaction(async (tx) => {
      await tx.query('CREATE TABLE account_probe (id int)');
      await tx.query('CREATE TABLE probe_notes (account_id uuid REFERENCES accounts (id))');
      const found = await personalDataTables(tx);
      expect(found).toContain('account_probe');
      expect(found).toContain('probe_notes');
      expect(decided()).not.toEqual(found);
      await tx.query('DROP TABLE account_probe, probe_notes');
    });
  });
});

describe('exportAccount', () => {
  it('returns null for an unknown or malformed account', async () => {
    expect(await exportAccount(db, '00000000-0000-0000-0000-000000000001', NOW)).toBeNull();
    expect(await exportAccount(db, 'nope', NOW)).toBeNull();
  });

  it('contains the account, its own interests and answers, and both child profiles with theirs', async () => {
    const email = `fam${n++}@example.test`;
    const { id } = await family(email);
    const x = await exportAccount(db, id, NOW);
    expect(x).not.toBeNull();
    expect(x!.exportedAt).toBe(NOW.toISOString());
    expect(x!.account).toMatchObject({
      email,
      dateOfBirth: '1985-03-04',
      timeZone: 'Europe/Paris',
      consentState: 'none',
      consentAt: null,
      parentEmail: null,
      verifiedAt: T0.toISOString(),
      guardianConfirmedAt: T0.toISOString(),
      notify: { dailySet: true, weeklyCircle: false, invites: false },
    });
    expect(x!.account.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(x!.interests).toEqual({ topics: [topics[0].name], worlds: [worlds[0].slug] });
    expect(x!.answers).toEqual([
      { item: items[0].slug, world: worlds[0].slug, correct: true, answeredAt: T1.toISOString() },
    ]);
    expect(x!.childProfiles).toHaveLength(2);
    const [leo, mia] = [...x!.childProfiles].sort((a, b) => a.displayName.localeCompare(b.displayName));
    expect(mia).toEqual({
      displayName: 'Mia',
      ageBand: '6-9',
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      interests: { topics: [topics[1].name], worlds: [] },
      answers: [{ item: items[1].slug, world: worlds[1].slug, correct: false, answeredAt: T1.toISOString() }],
    });
    expect(leo).toEqual({
      displayName: 'Leo',
      ageBand: '10-12',
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      interests: { topics: [], worlds: [worlds[1].slug] },
      answers: [{ item: items[2].slug, world: worlds[0].slug, correct: true, answeredAt: T1.toISOString() }],
    });
  });

  it('has consent fields for a 13-15 account and masks the parent email', async () => {
    const email = `teen${n++}@example.test`;
    const parent = `guardian${n++}@family.test`;
    const id = await signedIn(email, '2012-01-01', parent);
    const tokens = await issueConsentTokens(db, id, T0);
    expect(await confirmConsent(db, tokens!.confirm, T1)).toBe('confirmed');
    const x = await exportAccount(db, id, NOW);
    expect(x!.account).toMatchObject({
      consentState: 'confirmed',
      consentAt: T1.toISOString(),
      parentEmail: 'g•••@family.test',
    });
    expect(JSON.stringify(x)).not.toContain(parent);
    expect(x!.childProfiles).toEqual([]);
  });

  it('never contains PIN fields, tokens, sessions or ids', async () => {
    const email = `sec${n++}@example.test`;
    const id = await signedIn(email, '2012-01-01', `p${n++}@family.test`);
    await issueConsentTokens(db, id, T0);
    await requestAccountLink(db, email, {}, T1);
    const fam = await family(`fam${n++}@example.test`);
    const secrets = (
      await db.query<{ s: string }>(
        `SELECT token_hash AS s FROM account_sessions UNION ALL SELECT token_hash FROM account_login_tokens
         UNION ALL SELECT token_hash FROM account_consent_tokens
         UNION ALL SELECT pin_hash FROM accounts WHERE pin_hash IS NOT NULL`,
      )
    ).rows.map((r) => r.s);
    expect(secrets.length).toBeGreaterThan(4);
    for (const accountId of [id, fam.id]) {
      const text = JSON.stringify(await exportAccount(db, accountId, NOW));
      for (const s of secrets) expect(text).not.toContain(s);
      for (const key of ['pin', 'token', 'session', 'hash', 'failures', 'locked', 'lock_count', 'lockCount']) {
        expect(text.toLowerCase()).not.toContain(`"${key.toLowerCase()}`);
      }
      for (const raw of [accountId, fam.mia, fam.leo]) expect(text).not.toContain(raw);
    }
  });

  it("never contains another account's rows", async () => {
    const a = await family(`a${n++}@example.test`);
    const bEmail = `b${n++}@example.test`;
    const b = await signedIn(bEmail, '1980-01-01');
    await child(b, 'Zed', '6-9');
    await recordAnswer(db, { accountId: b, profileId: null }, items[2].id, false, T0);
    const x = await exportAccount(db, a.id, NOW);
    const text = JSON.stringify(x);
    expect(text).not.toContain(bEmail);
    expect(text).not.toContain('Zed');
    expect(x!.answers).toHaveLength(1);
    expect(x!.childProfiles.map((c) => c.displayName).sort()).toEqual(['Leo', 'Mia']);
    const y = await exportAccount(db, b, NOW);
    expect(y!.answers).toEqual([
      { item: items[2].slug, world: worlds[0].slug, correct: false, answeredAt: T0.toISOString() },
    ]);
    expect(y!.childProfiles.map((c) => c.displayName)).toEqual(['Zed']);
    expect(y!.interests).toEqual({ topics: [], worlds: [] });
  });
});
