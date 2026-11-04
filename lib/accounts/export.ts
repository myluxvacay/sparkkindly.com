// Data export: everything held about an account and its child profiles, as one JSON-ready object. Ids, PIN fields,
// tokens and sessions are never included; the parent address only masked. Reads are scoped to the one account id from
// the server-side context and run in one REPEATABLE READ, READ ONLY transaction, so every section sees one snapshot.
// No Next.js imports; tests/unit/account-export.test.ts (which checks the table and column lists below against the
// live schema, so a new personal-data table or column fails until it is exported or excluded here).
import type { Db, Queryable } from '@/lib/db';
import { isUuid } from './pin';
import { maskEmail } from './wording';

// Personal-data tables whose rows for the account appear in the export.
export const EXPORTED_TABLES = ['accounts', 'child_profiles', 'profile_interests', 'item_responses'] as const;

// Personal-data tables deliberately left out, each with its reason.
export const EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  account_login_tokens: 'sign-in credentials (token hashes); short-lived and purged, never handed out',
  account_sessions: 'session credentials (token hashes) and device state; handing them out would weaken the account',
  account_consent_tokens: 'parental consent credentials (token hashes) bound to the parent address, not the holder',
  admin_users: 'site administrators (allow-listed staff), not member accounts; outside the member export',
  admin_login_tokens: 'administrator sign-in credentials (token hashes), not member accounts',
  admin_sessions: 'administrator session credentials (token hashes), not member accounts',
  events: 'site event log; profile_id is never written today (only item_published events). Revisit if that changes',
};

// Columns of the two tables exported row by row: each is exported or deliberately excluded with its reason.
export const EXPORTED_COLUMNS = {
  accounts: [
    'email',
    'date_of_birth',
    'time_zone',
    'consent_state',
    'parent_email',
    'verified_at',
    'last_sign_in_at',
    'created_at',
    'consent_at',
    'consent_reminded_at',
    'guardian_confirmed_at',
    'notify_daily_set',
    'notify_weekly_circle',
    'notify_invites',
    'inactivity_notice_at',
  ],
  child_profiles: ['display_name', 'age_band', 'created_at'],
} as const;

export const EXCLUDED_COLUMNS: Readonly<Record<keyof typeof EXPORTED_COLUMNS, Readonly<Record<string, string>>>> = {
  accounts: {
    id: 'internal identifier; meaningless outside the service and not needed to read the export',
    pin_hash: 'credential: salted scrypt hash of the adult PIN',
    pin_failures: 'security counter for PIN lockout; exposing it helps guessing',
    pin_lock_count: 'security counter for PIN lockout escalation',
    pin_locked_until: 'security lockout state for the PIN',
  },
  child_profiles: {
    id: 'internal identifier; meaningless outside the service',
    account_id: 'internal identifier of the owning account (the export is already that account)',
  },
};

type ExportInterests = { topics: string[]; worlds: string[] };
type ExportAnswer = { item: string; world: string; correct: boolean; answeredAt: string };
type ExportChild = {
  displayName: string;
  ageBand: string;
  createdAt: string;
  interests: ExportInterests;
  answers: ExportAnswer[];
};

export type AccountExport = {
  exportedAt: string;
  account: {
    email: string;
    dateOfBirth: string;
    timeZone: string;
    consentState: string;
    consentAt: string | null;
    consentRemindedAt: string | null;
    parentEmail: string | null;
    guardianConfirmedAt: string | null;
    inactivityNoticeAt: string | null;
    createdAt: string;
    verifiedAt: string | null;
    lastSignInAt: string | null;
    notify: { dailySet: boolean; weeklyCircle: boolean; invites: boolean };
  };
  interests: ExportInterests;
  answers: ExportAnswer[];
  childProfiles: ExportChild[];
};

type AccountRow = {
  email: string;
  dob: string;
  time_zone: string;
  consent_state: string;
  consent_at: Date | null;
  consent_reminded_at: Date | null;
  parent_email: string | null;
  guardian_confirmed_at: Date | null;
  inactivity_notice_at: Date | null;
  created_at: Date;
  verified_at: Date | null;
  last_sign_in_at: Date | null;
  d: boolean;
  w: boolean;
  i: boolean;
};

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);
const NIL = '00000000-0000-0000-0000-000000000000';
const ownerKey = (profileId: string | null) => profileId ?? NIL;

function accountSection(a: AccountRow): AccountExport['account'] {
  return {
    email: a.email,
    dateOfBirth: a.dob,
    timeZone: a.time_zone,
    consentState: a.consent_state,
    consentAt: iso(a.consent_at),
    consentRemindedAt: iso(a.consent_reminded_at),
    parentEmail: a.parent_email ? maskEmail(a.parent_email) : null,
    guardianConfirmedAt: iso(a.guardian_confirmed_at),
    inactivityNoticeAt: iso(a.inactivity_notice_at),
    createdAt: iso(a.created_at) as string,
    verifiedAt: iso(a.verified_at),
    lastSignInAt: iso(a.last_sign_in_at),
    notify: { dailySet: a.d, weeklyCircle: a.w, invites: a.i },
  };
}

// Interests of every profile of the account, keyed by profile (the holder under the zero uuid).
async function interestsByOwner(tx: Queryable, accountId: string): Promise<Map<string, ExportInterests>> {
  const r = await tx.query<{ p: string | null; topic: string | null; world: string | null }>(
    `SELECT pi.profile_id AS p, t.name AS topic, w.slug AS world
     FROM profile_interests pi LEFT JOIN topics t ON t.id = pi.topic_id LEFT JOIN worlds w ON w.id = pi.world_id
     WHERE pi.account_id = $1 ORDER BY t.name, w.slug`,
    [accountId],
  );
  const out = new Map<string, ExportInterests>();
  for (const row of r.rows) {
    const key = ownerKey(row.p);
    const entry = out.get(key) ?? { topics: [], worlds: [] };
    if (row.topic !== null) entry.topics.push(row.topic);
    if (row.world !== null) entry.worlds.push(row.world);
    out.set(key, entry);
  }
  return out;
}

async function answersByOwner(tx: Queryable, accountId: string): Promise<Map<string, ExportAnswer[]>> {
  const r = await tx.query<{ p: string | null; item: string; world: string; correct: boolean; at: Date }>(
    `SELECT r.profile_id AS p, i.slug AS item, w.slug AS world, r.correct, r.answered_at AS at
     FROM item_responses r JOIN items i ON i.id = r.item_id JOIN worlds w ON w.id = i.world_id
     WHERE r.account_id = $1 ORDER BY r.answered_at, i.slug`,
    [accountId],
  );
  const out = new Map<string, ExportAnswer[]>();
  for (const row of r.rows) {
    const key = ownerKey(row.p);
    const list = out.get(key) ?? [];
    list.push({ item: row.item, world: row.world, correct: row.correct, answeredAt: iso(row.at) as string });
    out.set(key, list);
  }
  return out;
}

async function readExport(tx: Queryable, accountId: string, now: Date): Promise<AccountExport | null> {
  const a = await tx.query<AccountRow>(
    `SELECT email, to_char(date_of_birth, 'YYYY-MM-DD') AS dob, time_zone, consent_state, consent_at,
            consent_reminded_at, parent_email, guardian_confirmed_at, inactivity_notice_at, created_at, verified_at,
            last_sign_in_at, notify_daily_set AS d, notify_weekly_circle AS w, notify_invites AS i
     FROM accounts WHERE id = $1`,
    [accountId],
  );
  if (!a.rows[0]) {
    return null;
  }
  const children = await tx.query<{ id: string; display_name: string; age_band: string; created_at: Date }>(
    'SELECT id, display_name, age_band, created_at FROM child_profiles WHERE account_id = $1 ORDER BY created_at, id',
    [accountId],
  );
  const interests = await interestsByOwner(tx, accountId);
  const answers = await answersByOwner(tx, accountId);
  const none = (): ExportInterests => ({ topics: [], worlds: [] });
  return {
    exportedAt: now.toISOString(),
    account: accountSection(a.rows[0]),
    interests: interests.get(NIL) ?? none(),
    answers: answers.get(NIL) ?? [],
    childProfiles: children.rows.map((c) => ({
      displayName: c.display_name,
      ageBand: c.age_band,
      createdAt: iso(c.created_at) as string,
      interests: interests.get(c.id) ?? none(),
      answers: answers.get(c.id) ?? [],
    })),
  };
}

export async function exportAccount(db: Db, accountId: string, now: Date): Promise<AccountExport | null> {
  if (!isUuid(accountId)) {
    return null;
  }
  return db.transaction(async (tx) => {
    // Must be the transaction's first statement.
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return readExport(tx, accountId, now);
  });
}
