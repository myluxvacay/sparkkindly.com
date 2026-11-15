// @vitest-environment node
// Account-addressed circle invites (Project 4.11, ADR 0004): sent from the leaderboard to one member's account.
// The inviter passes the usual invite gate; the invite is single-use, expires in 14 days, binds to its addressee,
// and is answered from the dashboard (accept joins under the shared rules; decline revokes).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { adult, circleOf } from '../helpers/circle-play';
import {
  acceptAccountInvite,
  createAccountInvite,
  declineAccountInvite,
  listAccountInvites,
  listInvitableCircles,
} from '@/lib/circles/invites';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-15T12:00:00Z');
const DAY = 86_400_000;

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

const isMember = async (circleId: string, accountId: string) =>
  (
    await db.query(
      'SELECT 1 FROM circle_members WHERE circle_id = $1 AND account_id = $2 AND profile_id IS NULL AND left_at IS NULL',
      [circleId, accountId],
    )
  ).rows.length === 1;

describe('account invites', () => {
  it('sends, lists, and accepts: the addressee joins and the invite is used up', async () => {
    const owner = await adult(db);
    const leader = await adult(db);
    const { slug, id } = await circleOf(db, owner, {});
    expect(await createAccountInvite(db, owner, slug, leader, NOW)).toBe('sent');
    expect(await createAccountInvite(db, owner, slug, leader, NOW)).toBe('duplicate');

    const pending = await listAccountInvites(db, leader, NOW);
    expect(pending).toHaveLength(1);
    expect(pending[0].circleName).toBe('Home');
    expect(pending[0].inviterName).toBe('Mum');

    // Nobody else can answer it.
    const other = await adult(db);
    expect((await acceptAccountInvite(db, other, pending[0].id, 'Eve', NOW)).status).toBe('invalid');

    const joined = await acceptAccountInvite(db, leader, pending[0].id, 'Lea', NOW);
    expect(joined.status).toBe('joined');
    expect(await isMember(id, leader)).toBe(true);
    expect(await listAccountInvites(db, leader, NOW)).toHaveLength(0);
    expect((await acceptAccountInvite(db, leader, pending[0].id, 'Lea', NOW)).status).toBe('invalid');
  });

  it('decline revokes the invite and it can no longer be accepted', async () => {
    const owner = await adult(db);
    const leader = await adult(db);
    const { slug } = await circleOf(db, owner, {});
    await createAccountInvite(db, owner, slug, leader, NOW);
    const [pending] = await listAccountInvites(db, leader, NOW);
    expect(await declineAccountInvite(db, leader, pending.id, NOW)).toBe(true);
    expect(await listAccountInvites(db, leader, NOW)).toHaveLength(0);
    expect((await acceptAccountInvite(db, leader, pending.id, 'Lea', NOW)).status).toBe('invalid');
  });

  it('refuses self-invites, existing members and non-member inviters; invites expire', async () => {
    const owner = await adult(db);
    const leader = await adult(db);
    const stranger = await adult(db);
    const { slug } = await circleOf(db, owner, {});
    expect(await createAccountInvite(db, owner, slug, owner, NOW)).toBe('invalid');
    expect(await createAccountInvite(db, stranger, slug, leader, NOW)).toBe('not_allowed');
    expect(await createAccountInvite(db, owner, slug, leader, NOW)).toBe('sent');
    const [pending] = await listAccountInvites(db, leader, NOW);
    const later = new Date(NOW.getTime() + 15 * DAY);
    expect(await listAccountInvites(db, leader, later)).toHaveLength(0);
    expect((await acceptAccountInvite(db, leader, pending.id, 'Lea', later)).status).toBe('invalid');
    // Once joined (through a fresh invite), a second invite to the same circle is already_member.
    const joined = await acceptAccountInvite(db, leader, pending.id, 'Lea', NOW);
    expect(joined.status).toBe('joined');
    expect(await createAccountInvite(db, owner, slug, leader, NOW)).toBe('already_member');
  });

  it('lists only the circles the member may invite into', async () => {
    const owner = await adult(db);
    const other = await adult(db);
    const { slug } = await circleOf(db, owner, { name: 'Home' });
    expect((await listInvitableCircles(db, owner, NOW)).map((c) => c.slug)).toEqual([slug]);
    expect(await listInvitableCircles(db, other, NOW)).toEqual([]);
  });
});
