// @vitest-environment node
// Circle mail selection and templates (plan 4D Task 1): who gets the set-ready, weekly and re-score emails, when, and
// what the text may show. The job that claims and sends is tested in circle-mail-job.test.ts.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { adult, childIn, circleOf, fixtures, item, join, type Fixtures } from '../helpers/circle-play';
import { readUnsubscribeToken } from '@/lib/accounts/unsubscribe';
import { dailyEmail, dailyMailFor, rescoreEmail, rescoreMailFor, weeklyEmail, weeklyMailFor, type MailBatch } from '@/lib/circles/mail';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let f: Fixtures;
const SECRET = 'test-only-unsubscribe-secret-0123456789abcdef';
const LINKS = { base: 'https://staging.sparkkindly.com', secret: SECRET };
const CAP = { mails: 200, circles: 50 };

beforeAll(async () => {
  db = await newTestDb();
  f = await fixtures(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM circles');
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM items');
});

type Prefs = { verified?: boolean; daily?: boolean; weekly?: boolean; consent?: 'none' | 'pending' | 'confirmed' };
async function member(p: Prefs = {}, dob = '1990-05-05'): Promise<{ id: string; email: string }> {
  const id = await adult(db);
  await db.query(
    `UPDATE accounts SET verified_at = $2, notify_daily_set = $3, notify_weekly_circle = $4, date_of_birth = $5 WHERE id = $1`,
    [id, p.verified === false ? null : '2026-11-01T00:00:00Z', p.daily ?? true, p.weekly ?? true, dob],
  );
  if (p.consent && p.consent !== 'none') {
    await db.query("UPDATE accounts SET consent_state = $2, parent_email = 'parent@example.test' WHERE id = $1", [id, p.consent]);
  }
  const email = (await db.query<{ email: string }>('SELECT email FROM accounts WHERE id = $1', [id])).rows[0].email;
  return { id, email };
}
const recipients = (b: MailBatch[]) => b.flatMap((x) => x.mails.map((m) => m.to)).sort();

describe('dailyMailFor: recipients', () => {
  it('only verified, opted-in, not consent-pending current account members get it', async () => {
    await item(db, { world: f.worlds.a });
    const owner = await member();
    const c = await circleOf(db, owner.id, { kind: 'friends' });
    const ok = await member();
    const cases = [
      await member({ verified: false }),
      await member({ daily: false }),
      await member({ consent: 'pending' }, '2012-01-01'),
    ];
    const left = await member();
    await join(db, c.slug, ok.id, 'Ok');
    for (const [i, m] of cases.entries()) await join(db, c.slug, m.id, `N${i}`);
    await join(db, c.slug, left.id, 'Left');
    await db.query('UPDATE circle_members SET left_at = now() WHERE account_id = $1', [left.id]);
    const b = await dailyMailFor(db, new Date('2026-11-05T08:00:00Z'), CAP, LINKS);
    expect(recipients(b)).toEqual([owner.email, ok.email].sort());
    expect(b[0].claim).toEqual({ circleId: c.id, kind: 'daily', period: '2026-11-05' });
  });

  it('a confirmed 13-15 account gets it when its preference is on', async () => {
    await item(db, { world: f.worlds.a });
    const owner = await member({ daily: false });
    const c = await circleOf(db, owner.id, { kind: 'friends' });
    const teen = await member({ consent: 'confirmed' }, '2012-01-01');
    await join(db, c.slug, teen.id, 'Teen');
    expect(recipients(await dailyMailFor(db, new Date('2026-11-05T08:00:00Z'), CAP, LINKS))).toEqual([teen.email]);
  });

  it('closed, hidden and solo-owner circles send nothing', async () => {
    await item(db, { world: f.worlds.a });
    const owner = await member();
    const solo = await circleOf(db, owner.id, { kind: 'friends' });
    const closed = await circleOf(db, owner.id, { kind: 'friends' });
    const hidden = await circleOf(db, owner.id, { kind: 'friends' });
    const other = await member();
    await join(db, closed.slug, other.id);
    await join(db, hidden.slug, other.id);
    await db.query("UPDATE circles SET status = 'closed', closed_at = now() WHERE id = $1", [closed.id]);
    await db.query('UPDATE circles SET hidden_at = now() WHERE id = $1', [hidden.id]);
    expect(solo.id).toBeTruthy();
    expect(await dailyMailFor(db, new Date('2026-11-05T08:00:00Z'), CAP, LINKS)).toEqual([]);
  });

  it('an empty set is claimed with no mail (nothing is ready)', async () => {
    const owner = await member();
    const c = await circleOf(db, owner.id, { kind: 'friends' });
    await join(db, c.slug, (await member()).id);
    const b = await dailyMailFor(db, new Date('2026-11-05T08:00:00Z'), CAP, LINKS);
    expect(b).toEqual([{ claim: { circleId: c.id, kind: 'daily', period: '2026-11-05' }, mails: [] }]);
  });
});

describe('dailyMailFor: timing', () => {
  it.each([
    ['UTC', '2026-11-05T06:59:00Z', '2026-11-05T07:00:00Z', '2026-11-05'],
    ['Pacific/Auckland', '2026-11-05T17:59:00Z', '2026-11-05T18:00:00Z', '2026-11-06'],
    ['America/Los_Angeles', '2026-11-05T14:59:00Z', '2026-11-05T15:00:00Z', '2026-11-05'],
  ])('%s: due only from 07:00 local, period is the local day', async (timeZone, before, after, period) => {
    await item(db, { world: f.worlds.a });
    const owner = await member();
    const c = await circleOf(db, owner.id, { kind: 'friends', timeZone });
    await join(db, c.slug, (await member()).id);
    expect(await dailyMailFor(db, new Date(before), CAP, LINKS)).toEqual([]);
    const b = await dailyMailFor(db, new Date(after), CAP, LINKS);
    expect(b.map((x) => x.claim.period)).toEqual([period]);
    await db.query("INSERT INTO circle_mail_log (circle_id, kind, period) VALUES ($1, 'daily', $2)", [c.id, period]);
    expect(await dailyMailFor(db, new Date(after), CAP, LINKS)).toEqual([]);
  });
});

describe('dailyMailFor: content', () => {
  it('names only the circle: no item title, no member or child name; unsubscribe for daily_set', async () => {
    await item(db, { world: f.worlds.a });
    await db.query("UPDATE items SET title = 'Xylophone Secret Title'");
    const owner = await member();
    const c = await circleOf(db, owner.id, { kind: 'family', name: 'Grandmaquinn' });
    await childIn(db, owner.id, c.slug, 'Zephyrine');
    const b = await dailyMailFor(db, new Date('2026-11-05T08:00:00Z'), CAP, LINKS);
    const m = b[0].mails[0];
    for (const hidden of ['Xylophone', 'Zephyrine', 'Grandmaquinn']) {
      expect(m.subject + m.text + JSON.stringify(m.headers)).not.toContain(hidden);
    }
    expect(m.text).toContain('Home');
    expect(m.text).toContain(`https://staging.sparkkindly.com/circles/${c.slug}/set/`);
    const token = /\/account\/unsubscribe\/\?t=([^\s]+)/.exec(m.text)![1];
    expect(readUnsubscribeToken(SECRET, token)).toEqual({ accountId: owner.id, kind: 'daily_set' });
    expect(m.headers).toEqual({
      'List-Unsubscribe': `<https://staging.sparkkindly.com/account/unsubscribe/confirm/?t=${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('templates', () => {
    expect(dailyEmail('Home', 'https://x.test/s/')).toEqual({
      subject: 'Your SparkKindly set for Home is ready',
      text: expect.stringContaining('https://x.test/s/'),
    });
    expect(rescoreEmail('Home', 'https://x.test/c/').text).toContain('re-marked');
    expect(weeklyEmail('Home', 'https://x.test/w/', { rows: [{ name: null, rank: 2, points: 30 }], total: 70, members: 3 }).text).toMatch(
      /You: rank 2, 30 points[\s\S]*Circle total: 70 points[\s\S]*Members: 3/,
    );
  });

  it('without a usable secret nothing is selected', async () => {
    await item(db, { world: f.worlds.a });
    const owner = await member();
    const c = await circleOf(db, owner.id, { kind: 'friends' });
    await join(db, c.slug, (await member()).id);
    expect(await dailyMailFor(db, new Date('2026-11-05T08:00:00Z'), CAP, { ...LINKS, secret: 'short' })).toEqual([]);
  });
});

describe('weeklyMailFor', () => {
  // 2026-11-09 is a Monday; last week is 2026-11-02 .. 2026-11-08.
  it.each([
    ['UTC', '2026-11-09T07:59:00Z', '2026-11-09T08:00:00Z'],
    ['Pacific/Auckland', '2026-11-08T18:59:00Z', '2026-11-08T19:00:00Z'],
  ])('%s: due from Monday 08:00 local, once per week', async (timeZone, before, after) => {
    const owner = await member();
    const c = await circleOf(db, owner.id, { kind: 'friends', timeZone });
    await join(db, c.slug, (await member()).id);
    expect(await weeklyMailFor(db, new Date(before), CAP, LINKS)).toEqual([]);
    const b = await weeklyMailFor(db, new Date(after), CAP, LINKS);
    expect(b.map((x) => x.claim)).toEqual([{ circleId: c.id, kind: 'weekly', period: '2026-11-09' }]);
    await db.query("INSERT INTO circle_mail_log (circle_id, kind, period) VALUES ($1, 'weekly', '2026-11-09')", [c.id]);
    expect(await weeklyMailFor(db, new Date('2026-11-10T12:00:00Z'), CAP, LINKS)).toEqual([]);
  });

  it('a missed Monday is caught up later that week', async () => {
    const owner = await member();
    const c = await circleOf(db, owner.id, { kind: 'friends' });
    await join(db, c.slug, (await member()).id);
    expect((await weeklyMailFor(db, new Date('2026-11-11T12:00:00Z'), CAP, LINKS)).map((x) => x.claim.period)).toEqual(['2026-11-09']);
  });

  it('shows only the recipient’s own rank and points (account and own children), the total and member count', async () => {
    const quiz = await item(db, { world: f.worlds.a });
    const mum = await member();
    const c = await circleOf(db, mum.id, { kind: 'family', name: 'Mumsname' });
    const kid = await childIn(db, mum.id, c.slug, 'Zephyrine');
    const bea = await member({ weekly: true });
    await join(db, c.slug, bea.id, 'Beatrixa');
    const optedOut = await member({ weekly: false });
    await join(db, c.slug, optedOut.id, 'Quiet');
    await db.query("INSERT INTO circle_daily_sets (circle_id, day, position, item_id) VALUES ($1, '2026-11-04', 1, $2)", [c.id, quiz]);
    const answer = (account: string, profile: string | null) =>
      db.query("INSERT INTO item_responses (account_id, profile_id, item_id, correct, answered_at) VALUES ($1, $2, $3, true, '2026-11-04T12:00:00Z')", [account, profile, quiz]);
    await answer(mum.id, kid);
    await answer(bea.id, null);
    const b = await weeklyMailFor(db, new Date('2026-11-09T09:00:00Z'), CAP, LINKS);
    const byTo = new Map(b[0].mails.map((m) => [m.to, m]));
    expect([...byTo.keys()].sort()).toEqual([mum.email, bea.email].sort());
    const mumText = byTo.get(mum.email)!.text;
    expect(mumText).toMatch(/You: rank 3, 0 points/);
    expect(mumText).toMatch(/Zephyrine: rank 1, 10 points/);
    expect(mumText).toMatch(/Circle total: 20 points/);
    expect(mumText).toMatch(/Members: 4/);
    expect(mumText).not.toMatch(/Beatrixa|Mumsname|Quiet/);
    const beaText = byTo.get(bea.email)!.text;
    expect(beaText).toMatch(/You: rank 1, 10 points/);
    expect(beaText).not.toMatch(/Zephyrine|Mumsname|Quiet|Beatrixa/);
    const token = /\/account\/unsubscribe\/\?t=([^\s]+)/.exec(beaText)![1];
    expect(readUnsubscribeToken(SECRET, token)).toEqual({ accountId: bea.id, kind: 'weekly_circle' });
  });
});

describe('rescoreMailFor', () => {
  it('one mail per daily-opted recipient per notice of the last day, never twice', async () => {
    const quiz = await item(db, { world: f.worlds.a });
    const owner = await member();
    const c = await circleOf(db, owner.id, { kind: 'friends' });
    const off = await member({ daily: false });
    await join(db, c.slug, off.id);
    const now = new Date('2026-11-05T12:00:00Z');
    const notice = async (at: string) =>
      (await db.query<{ id: string }>("INSERT INTO circle_notices (circle_id, item_id, kind, created_at) VALUES ($1, $2, 'rescored', $3) RETURNING id::text", [c.id, quiz, at])).rows[0].id;
    const a = await notice('2026-11-05T10:00:00Z');
    const b = await notice('2026-11-05T11:00:00Z');
    await notice('2026-11-03T11:00:00Z');
    const got = await rescoreMailFor(db, now, CAP, LINKS);
    expect(got.map((x) => x.claim)).toEqual([
      { circleId: c.id, kind: 'rescore', period: a },
      { circleId: c.id, kind: 'rescore', period: b },
    ]);
    expect(got.map((x) => x.mails.map((m) => m.to))).toEqual([[owner.email], [owner.email]]);
    expect(got[0].mails[0].text).not.toMatch(/Item \d/);
    await db.query("INSERT INTO circle_mail_log (circle_id, kind, period) VALUES ($1, 'rescore', $2)", [c.id, a]);
    expect((await rescoreMailFor(db, now, CAP, LINKS)).map((x) => x.claim.period)).toEqual([b]);
  });
});

describe('caps', () => {
  it('stops at the circle cap and never splits a circle across the mail cap', async () => {
    await item(db, { world: f.worlds.a });
    for (let i = 0; i < 3; i++) {
      const owner = await member();
      const c = await circleOf(db, owner.id, { kind: 'friends' });
      await join(db, c.slug, (await member()).id);
    }
    const at = new Date('2026-11-05T08:00:00Z');
    expect(await dailyMailFor(db, at, { mails: 200, circles: 2 }, LINKS)).toHaveLength(2);
    const b = await dailyMailFor(db, at, { mails: 3, circles: 50 }, LINKS);
    expect(b).toHaveLength(1);
    expect(b[0].mails).toHaveLength(2);
  });
});
