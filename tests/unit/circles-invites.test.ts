// @vitest-environment node
// Circle invites (plan 4B Task 1): link and email invites, preview, acceptance, revocation, limits, referrals, deletion,
// export and the purge of spent invites.
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { signUp } from '@/lib/accounts/signup';
import { deleteAccount } from '@/lib/accounts/delete';
import { exportAccount } from '@/lib/accounts/export';
import { hash } from '@/lib/tokens';
import { createCircle } from '@/lib/circles/repo';
import { closeCircle } from '@/lib/circles/owner';
import { tick } from '@/worker/main';
import {
  INVITE_LIMITS,
  acceptInvite,
  createEmailInvite,
  createLinkInvite,
  previewInvite,
  purgeExpiredInvites,
  recordOpen,
  revokeInvite,
  type InviteMail,
} from '@/lib/circles/invites';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const T0 = new Date('2026-11-01T08:00:00Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(T0.getTime() + ms);
let n = 0;

beforeAll(async () => {
  db = await newTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM circles');
  await db.query('DELETE FROM accounts');
});

// An account created two days before T0 unless `fresh` (ten minutes before `when`).
async function account(dateOfBirth = '1990-05-05', opts: { fresh?: Date; email?: string } = {}): Promise<string> {
  const teen = dateOfBirth.startsWith('2012');
  const r = await signUp(
    db,
    { email: opts.email ?? `inv${n++}@example.test`, dateOfBirth, parentEmail: teen ? `par${n++}@example.test` : undefined },
    T0,
  );
  if (r.status !== 'created') throw new Error('sign-up failed');
  const created = opts.fresh ? new Date(opts.fresh.getTime() - 10 * 60_000) : at(-2 * DAY);
  await db.query('UPDATE accounts SET created_at = $2 WHERE id = $1', [r.accountId, created.toISOString()]);
  return r.accountId;
}
async function circle(owner: string, kind = 'friends', name = 'Quiz Club') {
  const r = await createCircle(db, owner, { name, kind, yourName: 'Olly Owner' }, T0);
  if (r.status !== 'created') throw new Error(`create failed: ${r.status}`);
  return r.slug;
}
async function addMember(slug: string, accountId: string, name = 'Mo Member') {
  await db.query(
    'INSERT INTO circle_members (circle_id, account_id, display_name) SELECT id, $2, $3 FROM circles WHERE slug = $1',
    [slug, accountId, name],
  );
}
async function link(accountId: string, slug: string, now = T0) {
  const r = await createLinkInvite(db, accountId, slug, now);
  if (r.status !== 'created') throw new Error(`link failed: ${r.status}`);
  return r.token;
}
function mailbox() {
  const sent: InviteMail[] = [];
  return { sent, send: async (m: InviteMail) => void sent.push(m) };
}
const invites = async () => (await db.query('SELECT * FROM circle_invites ORDER BY created_at, id')).rows;
const count = async (sql: string, p: unknown[] = []) => (await db.query<{ n: number }>(sql, p)).rows[0].n;

describe('link invites', () => {
  it('a 43-character base64url token, stored only as its sha256 hash', async () => {
    const owner = await account();
    const token = await link(owner, await circle(owner));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await invites();
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hash(token));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]).toMatchObject({ kind: 'link', expires_at: null, invited_email: null });
  });

  it('is reusable by two accounts until regenerated, and regenerating kills the old token', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const token = await link(owner, slug);
    const [a, b, c] = [await account(), await account(), await account()];
    expect(await acceptInvite(db, a, token, 'Ann', T0)).toEqual({ status: 'joined', slug });
    expect(await acceptInvite(db, b, token, 'Ben', T0)).toEqual({ status: 'joined', slug });
    const fresh = await link(owner, slug, at(1000));
    expect(fresh).not.toBe(token);
    expect(await previewInvite(db, token, T0)).toBeNull();
    expect(await acceptInvite(db, c, token, 'Cat', T0)).toEqual({ status: 'invalid' });
    expect(await acceptInvite(db, c, fresh, 'Cat', T0)).toEqual({ status: 'joined', slug });
  });

  it('revoke kills it; a member cannot revoke the owner’s invite, the owner can revoke a member’s', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const member = await account();
    await addMember(slug, member);
    const ownerToken = await link(owner, slug);
    const memberToken = await link(member, slug, at(1));
    const [ownerInvite, memberInvite] = (await invites()).map((r) => r.id as string);
    expect(await revokeInvite(db, member, slug, ownerInvite, T0)).toBe(false);
    expect(await previewInvite(db, ownerToken, T0)).not.toBeNull();
    expect(await revokeInvite(db, owner, slug, memberInvite, T0)).toBe(true);
    expect(await previewInvite(db, memberToken, T0)).toBeNull();
    expect(await acceptInvite(db, await account(), memberToken, 'Zed', T0)).toEqual({ status: 'invalid' });
    expect(await revokeInvite(db, owner, slug, ownerInvite, T0)).toBe(true);
    expect(await revokeInvite(db, owner, slug, ownerInvite, T0)).toBe(false);
  });

  it('each member has their own link: a member regenerating leaves the owner’s link working', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const member = await account();
    await addMember(slug, member);
    const ownerToken = await link(owner, slug);
    await link(member, slug);
    await link(member, slug);
    expect(await previewInvite(db, ownerToken, T0)).not.toBeNull();
  });

  it('stops working once its creator is no longer a member', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const member = await account();
    await addMember(slug, member);
    const token = await link(member, slug);
    await db.query('UPDATE circle_members SET left_at = $2 WHERE account_id = $1', [member, T0.toISOString()]);
    expect(await previewInvite(db, token, T0)).toBeNull();
    expect(await acceptInvite(db, await account(), token, 'Zed', T0)).toEqual({ status: 'invalid' });
  });

  it('a non-member, a member without the invite capability and a closed circle cannot create one', async () => {
    const owner = await account();
    const slug = await circle(owner);
    expect(await createLinkInvite(db, await account(), slug, T0)).toEqual({ status: 'not_allowed' });
    const pending = await account('2012-01-01');
    await addMember(slug, pending);
    expect(await createLinkInvite(db, pending, slug, T0)).toEqual({ status: 'not_allowed' });
    expect(await createLinkInvite(db, owner, 'zzzzzzzzzz', T0)).toEqual({ status: 'not_allowed' });
    expect(await createLinkInvite(db, 'nope', slug, T0)).toEqual({ status: 'not_allowed' });
    expect(await closeCircle(db, owner, slug, T0)).toBe('closed');
    expect(await createLinkInvite(db, owner, slug, T0)).toEqual({ status: 'closed' });
    expect(await invites()).toEqual([]);
  });
});

describe('previewInvite and recordOpen', () => {
  it('returns only the circle name, kind and member count, and never changes the invite', async () => {
    const owner = await account();
    const slug = await circle(owner, 'friends', 'Night Owls');
    await addMember(slug, await account(), 'Secret Name');
    const token = await link(owner, slug);
    const before = await invites();
    for (let i = 0; i < 3; i++) {
      const p = await previewInvite(db, token, T0);
      expect(p).toEqual({ circleName: 'Night Owls', kind: 'friends', memberCount: 2 });
      expect(Object.keys(p!).sort()).toEqual(['circleName', 'kind', 'memberCount']);
    }
    expect(await invites()).toEqual(before);
    await recordOpen(db, token);
    await recordOpen(db, token);
    expect((await invites())[0].opens).toBe(2);
  });

  it('is null for an unknown, malformed, revoked or hidden-circle token', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const token = await link(owner, slug);
    for (const bad of ['', 'short', 'A'.repeat(43), `${token}x`, 7 as unknown as string]) {
      expect(await previewInvite(db, bad, T0)).toBeNull();
    }
    await db.query('UPDATE circles SET hidden_at = $2 WHERE slug = $1', [slug, T0.toISOString()]);
    expect(await previewInvite(db, token, T0)).toBeNull();
    await recordOpen(db, 'A'.repeat(43));
  });
});

describe('email invites', () => {
  it('sends one mail naming the inviter by their circle name and the circle, and is single use', async () => {
    const owner = await account();
    const slug = await circle(owner, 'friends', 'Quiz Club');
    const box = mailbox();
    expect(await createEmailInvite(db, owner, slug, '  Friend@Example.TEST ', T0, box.send)).toBe('sent');
    expect(box.sent).toHaveLength(1);
    const mail = box.sent[0];
    expect(mail).toMatchObject({ to: 'friend@example.test', inviterName: 'Olly Owner', circleName: 'Quiz Club', recipientAccountId: null });
    expect(mail.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = (await invites())[0];
    expect(row).toMatchObject({ kind: 'email', invited_email: 'friend@example.test', token_hash: hash(mail.token) });
    expect(new Date(row.expires_at as string).getTime()).toBe(T0.getTime() + 14 * DAY);

    const a = await account();
    expect(await acceptInvite(db, a, mail.token, 'Ann', at(1000))).toEqual({ status: 'joined', slug });
    const used = (await invites())[0];
    expect(used).toMatchObject({ invited_email: null, used_by: a });
    expect(used.used_at).not.toBeNull();
    expect(await acceptInvite(db, await account(), mail.token, 'Ben', at(2000))).toEqual({ status: 'invalid' });
    expect(await previewInvite(db, mail.token, at(2000))).toBeNull();
  });

  it('expires exactly 14 days after creation', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const box = mailbox();
    await createEmailInvite(db, owner, slug, 'a@example.test', T0, box.send);
    await createEmailInvite(db, owner, slug, 'b@example.test', T0, box.send);
    const [early, late] = box.sent.map((m) => m.token);
    expect(await acceptInvite(db, await account(), early, 'Ann', at(14 * DAY - 1))).toEqual({ status: 'joined', slug });
    expect(await previewInvite(db, late, at(14 * DAY))).toBeNull();
    expect(await acceptInvite(db, await account(), late, 'Ben', at(14 * DAY))).toEqual({ status: 'invalid' });
  });

  it('stops working when the circle closes', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const box = mailbox();
    await createEmailInvite(db, owner, slug, 'a@example.test', T0, box.send);
    const l = await link(owner, slug);
    await closeCircle(db, owner, slug, at(1000));
    for (const t of [box.sent[0].token, l]) {
      expect(await previewInvite(db, t, at(2000))).toBeNull();
      expect(await acceptInvite(db, await account(), t, 'Ann', at(2000))).toEqual({ status: 'invalid' });
    }
    expect(await createEmailInvite(db, owner, slug, 'c@example.test', at(2000), box.send)).toBe('closed');
  });

  it('refuses a bad address, a non-member and a duplicate of an active invite', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const box = mailbox();
    for (const bad of ['', 'not-an-address', 42, 'ﬀ@example.test']) {
      expect(await createEmailInvite(db, owner, slug, bad, T0, box.send)).toBe('invalid');
    }
    expect(await createEmailInvite(db, await account(), slug, 'x@example.test', T0, box.send)).toBe('not_allowed');
    expect(await createEmailInvite(db, owner, slug, 'x@example.test', T0, box.send)).toBe('sent');
    expect(await createEmailInvite(db, owner, slug, 'X@example.test', T0, box.send)).toBe('duplicate');
    expect(box.sent).toHaveLength(1);
  });

  it('limits: 10 per account per day, 3 per address per circle', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const box = mailbox();
    for (let i = 0; i < INVITE_LIMITS.emailsPerDay; i++) {
      expect(await createEmailInvite(db, owner, slug, `p${i}@example.test`, at(i), box.send)).toBe('sent');
    }
    expect(await createEmailInvite(db, owner, slug, 'late@example.test', at(60_000), box.send)).toBe('limit');
    expect(await createEmailInvite(db, owner, slug, 'late@example.test', at(DAY + 1), box.send)).toBe('sent');

    const other = await circle(owner, 'friends', 'Other');
    const next = at(3 * DAY);
    for (let i = 0; i < INVITE_LIMITS.perAddress; i++) {
      expect(await createEmailInvite(db, owner, other, 'same@example.test', at(3 * DAY + i), box.send)).toBe('sent');
      const id = (await db.query<{ id: string }>("SELECT id FROM circle_invites WHERE invited_email = 'same@example.test' AND revoked_at IS NULL")).rows[0].id;
      expect(await revokeInvite(db, owner, other, id, next)).toBe(true);
    }
    expect(await createEmailInvite(db, owner, other, 'same@example.test', at(3 * DAY + 10), box.send)).toBe('limit');
  });

  it('sends nothing to an account that turned invite email off, but the sender still sees sent', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const off = await account('1990-05-05', { email: 'quiet@example.test' });
    const on = await account('1990-05-05', { email: 'keen@example.test' });
    await db.query('UPDATE accounts SET notify_invites = true WHERE id = $1', [on]);
    const box = mailbox();
    expect(await createEmailInvite(db, owner, slug, 'quiet@example.test', T0, box.send)).toBe('sent');
    expect(box.sent).toEqual([]);
    expect(await createEmailInvite(db, owner, slug, 'keen@example.test', T0, box.send)).toBe('sent');
    expect(box.sent.map((m) => [m.to, m.recipientAccountId])).toEqual([['keen@example.test', on]]);
    expect(off).not.toBe(on);
  });

  it('a send failure still answers sent and leaves the invite in place', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const r = await createEmailInvite(db, owner, slug, 'a@example.test', T0, async () => {
      throw new Error('boom a@example.test');
    });
    expect(r).toBe('sent');
    expect(await invites()).toHaveLength(1);
  });
});

describe('acceptInvite join rules', () => {
  it('needs a name, refuses a 13-15 account into a community, and a member joining twice', async () => {
    const owner = await account();
    const community = await circle(owner, 'community', 'Open Club');
    const token = await link(owner, community);
    const teen = await account('2012-01-01');
    await db.query("UPDATE accounts SET consent_state = 'confirmed' WHERE id = $1", [teen]);
    expect(await acceptInvite(db, teen, token, 'Tia', T0)).toEqual({ status: 'community_age' });
    expect(await acceptInvite(db, teen, token, '', T0)).toEqual({ status: 'name' });
    expect(await acceptInvite(db, owner, token, 'Olly', T0)).toEqual({ status: 'already_member' });
  });
});

describe('referrals', () => {
  const referrals = async () => (await db.query('SELECT invite_id, new_account_id FROM referrals')).rows;

  it('records one row for a fresh account joining for the first time, and none for an existing member', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const token = await link(owner, slug);
    const fresh = await account('1990-05-05', { fresh: T0 });
    expect(await acceptInvite(db, fresh, token, 'New', T0)).toEqual({ status: 'joined', slug });
    const inviteId = (await invites())[0].id;
    expect(await referrals()).toEqual([{ invite_id: inviteId, new_account_id: fresh }]);
    // Joining a second circle through another invite does not add a second row.
    const other = await circle(owner, 'friends', 'Second');
    await acceptInvite(db, fresh, await link(owner, other), 'New', at(60_000));
    expect(await referrals()).toHaveLength(1);
    // An old account, and a fresh one that already belongs to a circle, are not referrals.
    await acceptInvite(db, await account(), token, 'Old', T0);
    const busy = await account('1990-05-05', { fresh: T0 });
    await addMember(other, busy);
    await acceptInvite(db, busy, token, 'Busy', T0);
    expect(await referrals()).toHaveLength(1);
    expect(JSON.stringify(await db.query('SELECT * FROM referrals'))).not.toMatch(/New|Olly/);
  });
});

describe('deletion and export', () => {
  it("deleting an account removes its invites, its referral row and pending invites to its address", async () => {
    const owner = await account();
    const slug = await circle(owner);
    const member = await account();
    await addMember(slug, member);
    await link(member, slug);
    const fresh = await account('1990-05-05', { fresh: T0, email: 'target@example.test' });
    await acceptInvite(db, fresh, await link(owner, slug), 'Fresh', T0);
    await createEmailInvite(db, owner, slug, 'target@example.test', T0, mailbox().send);
    expect(await count('SELECT count(*)::int AS n FROM circle_invites')).toBe(3);
    expect(await deleteAccount(db, member, T0)).toBe(true);
    expect(await count('SELECT count(*)::int AS n FROM circle_invites WHERE created_by = $1', [member])).toBe(0);
    expect(await deleteAccount(db, fresh, T0)).toBe(true);
    expect(await count('SELECT count(*)::int AS n FROM referrals')).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM circle_invites WHERE invited_email = 'target@example.test'")).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM circle_invites')).toBe(1);
  });

  it('export lists the invites the account created, without invitee addresses, and its own referral', async () => {
    const owner = await account();
    const slug = await circle(owner, 'friends', 'Quiz Club');
    await link(owner, slug);
    await createEmailInvite(db, owner, slug, 'invitee@example.test', at(1), mailbox().send);
    const x = await exportAccount(db, owner, at(1000));
    expect(x!.invites).toEqual([
      { circle: 'Quiz Club', kind: 'link', createdAt: T0.toISOString(), expiresAt: null, revokedAt: null, usedAt: null },
      {
        circle: 'Quiz Club',
        kind: 'email',
        createdAt: at(1).toISOString(),
        expiresAt: at(14 * DAY + 1).toISOString(),
        revokedAt: null,
        usedAt: null,
      },
    ]);
    expect(x!.joinedThroughInviteAt).toBeNull();
    expect(JSON.stringify(x)).not.toContain('invitee@');
    const fresh = await account('1990-05-05', { fresh: T0 });
    await acceptInvite(db, fresh, await link(owner, slug, at(5)), 'Fresh', at(10));
    const y = await exportAccount(db, fresh, at(1000));
    expect(y!.joinedThroughInviteAt).toBe(at(10).toISOString());
    expect(y!.invites).toEqual([]);
  });
});

describe('purgeExpiredInvites', () => {
  it('nulls addresses of spent invites, deletes them 14 days later unless a referral needs them, and respects the cap', async () => {
    const owner = await account();
    const slug = await circle(owner);
    const box = mailbox();
    for (const e of ['a@example.test', 'b@example.test', 'c@example.test']) {
      await createEmailInvite(db, owner, slug, e, T0, box.send);
    }
    const live = await link(owner, slug, at(1));
    const old = await link(owner, slug, at(2)); // revokes `live`
    expect(live).not.toBe(old);
    // Day 14: the three email invites have just expired.
    expect(await purgeExpiredInvites(db, at(14 * DAY), 2)).toBe(2);
    expect(await count('SELECT count(*)::int AS n FROM circle_invites WHERE invited_email IS NOT NULL')).toBe(1);
    expect(await purgeExpiredInvites(db, at(14 * DAY), 100)).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM circle_invites')).toBe(5);
    // A referral keeps the revoked link it came through.
    const fresh = await account('1990-05-05', { fresh: at(3) });
    await acceptInvite(db, fresh, old, 'Fresh', at(3));
    await link(owner, slug, at(4)); // revokes `old`
    // Day 28 and a bit: the expired email invites and the first revoked link go; the referred link and the active one stay.
    expect(await purgeExpiredInvites(db, at(28 * DAY + 10), 100)).toBe(4);
    const left = await invites();
    expect(left).toHaveLength(2);
    expect(left[0].token_hash).toBe(hash(old));
    expect(left[1].revoked_at).toBeNull();
  });
});

describe('worker', () => {
  it('runs the invite purge once a day, after the circles purge', async () => {
    await db.query('DELETE FROM job_runs');
    const owner = await account();
    await createEmailInvite(db, owner, await circle(owner), 'a@example.test', T0, mailbox().send);
    const now = at(15 * DAY);
    const log = await tick(db, now, {}, async () => undefined, { delayMs: 0, dbNow: async () => now });
    const line = log.findIndex((l) => l.startsWith('invites purge: 1 changed'));
    expect(line).toBeGreaterThan(log.findIndex((l) => l.startsWith('circles purge:')));
    expect(await count('SELECT count(*)::int AS n FROM circle_invites WHERE invited_email IS NOT NULL')).toBe(0);
    const again = await tick(db, now, {}, async () => undefined, { delayMs: 0, dbNow: async () => now });
    expect(again, again.join(";")).not.toContainEqual(expect.stringMatching(/^invites purge/));
  });
});
