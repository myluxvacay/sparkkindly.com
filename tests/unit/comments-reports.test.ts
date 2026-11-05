// @vitest-environment node
// Comment reports (plan 7B Task 1): who may report, weights and the hide threshold, urgent reports and the owner alert,
// false reports, and what a hide means for other members. The reporter always comes from the server-side context.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { comment, item, person, setLevel, statusOf, trustRow } from '../helpers/comments';
import { seedReference } from '@/db/seed';
import type { AccountContext } from '@/lib/accounts/context';
import { createChildProfile } from '@/lib/accounts/children';
import { deleteAccount } from '@/lib/accounts/delete';
import { switchToProfile, getContext } from '@/lib/accounts/context';
import { listPublishedComments } from '@/lib/comments/repo';
import { dismissReports, reportComment, reportWeight, REPORT_LIMIT, URGENT_LIMIT, type NotifyOwner } from '@/lib/comments/reports';
import { ownerAlert } from '@/lib/comments/notices';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T12:00:00Z');
const quiet: NotifyOwner = async () => {};

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM items');
});

const report = (ctx: AccountContext | null, id: string, input: Record<string, unknown> = { reason: 'abuse' }, notify = quiet, now = NOW) =>
  reportComment(db, ctx, id, input as { reason: unknown }, now, notify);

async function reporter(level: 0 | 1) {
  const p = await person(db, NOW);
  await setLevel(db, p.id, level);
  return p;
}
async function target(body = 'some words') {
  const author = await person(db, NOW);
  const it = await item(db);
  return { author, it, id: await comment(db, it, author.id, body) };
}

describe('reportWeight', () => {
  it('level 1 counts 1, level 0 counts 0.5, a muted reporter counts 0', () => {
    expect(reportWeight({ level: 1, reportsMuted: false })).toBe(1);
    expect(reportWeight({ level: 0, reportsMuted: false })).toBe(0.5);
    expect(reportWeight({ level: 1, reportsMuted: true })).toBe(0);
  });
});

describe('the hide threshold', () => {
  it('two level-1 reports hide; level-1 plus level-0 does not; four level-0 do', async () => {
    const a = await target();
    expect(await report((await reporter(1)).ctx, a.id)).toEqual({ status: 'reported' });
    expect(await report((await reporter(1)).ctx, a.id)).toEqual({ status: 'hidden' });
    expect(await statusOf(db, a.id)).toBe('hidden');

    const b = await target();
    expect(await report((await reporter(1)).ctx, b.id)).toEqual({ status: 'reported' });
    expect(await report((await reporter(0)).ctx, b.id)).toEqual({ status: 'reported' });
    expect(await statusOf(db, b.id)).toBe('published');

    const c = await target();
    for (let i = 0; i < 3; i++) expect(await report((await reporter(0)).ctx, c.id)).toEqual({ status: 'reported' });
    expect(await report((await reporter(0)).ctx, c.id)).toEqual({ status: 'hidden' });
  });

  it('a brand-new account (no trust row) counts 0.5 and cannot hide alone', async () => {
    const a = await target();
    const fresh = await person(db, NOW);
    expect(await report(fresh.ctx, a.id, { reason: 'abuse' })).toEqual({ status: 'reported' });
    expect(await report(fresh.ctx, a.id, { reason: 'other' })).toEqual({ status: 'refused', code: 'duplicate' });
    expect(await statusOf(db, a.id)).toBe('published');
  });

  it('a muted reporter weighs 0', async () => {
    const a = await target();
    const muted = await reporter(1);
    await db.query('UPDATE account_trust SET reports_muted = true WHERE account_id = $1', [muted.id]);
    expect(await report(muted.ctx, a.id)).toEqual({ status: 'reported' });
    expect(await report((await reporter(1)).ctx, a.id)).toEqual({ status: 'reported' });
    expect(await statusOf(db, a.id)).toBe('published');
  });

  it('a hidden comment is gone for everyone else: the public listing leaves it out', async () => {
    const a = await target('to be hidden');
    await report((await reporter(1)).ctx, a.id);
    await report((await reporter(1)).ctx, a.id);
    expect(await listPublishedComments(db, a.it, NOW)).toEqual([]);
    expect(await listPublishedComments(db, a.it, NOW, (await reporter(1)).id)).toEqual([]);
  });

  it('race: two reporters crossing the threshold at once hide it exactly once', async () => {
    const a = await target();
    await report((await reporter(1)).ctx, a.id);
    const [x, y] = [await reporter(1), await reporter(1)];
    const notify = vi.fn(quiet);
    const out = await Promise.all([report(x.ctx, a.id, { reason: 'abuse' }, notify), report(y.ctx, a.id, { reason: 'abuse' }, notify)]);
    expect(out.filter((r) => r.status === 'hidden')).toHaveLength(1);
    expect(await statusOf(db, a.id)).toBe('hidden');
  });
});

describe('who may report what', () => {
  it('refuses own, duplicate, and comments that are not published (held, hidden, rejected, deleted, unknown)', async () => {
    const a = await target();
    expect(await report(a.author.ctx, a.id)).toEqual({ status: 'refused', code: 'own' });
    const r = await reporter(0);
    await report(r.ctx, a.id);
    expect(await report(r.ctx, a.id)).toEqual({ status: 'refused', code: 'duplicate' });
    for (const status of ['held', 'hidden', 'rejected', 'deleted']) {
      const id = await comment(db, a.it, a.author.id, `words ${status}`, status);
      expect(await report(r.ctx, id), status).toEqual({ status: 'refused', code: 'not_found' });
    }
    expect(await report(r.ctx, '00000000-0000-4000-8000-000000000000')).toEqual({ status: 'refused', code: 'not_found' });
    expect(await report(r.ctx, 'not-a-uuid')).toEqual({ status: 'refused', code: 'not_found' });
  });

  it('refuses a comment on an item whose comments are switched off', async () => {
    const a = await target();
    await db.query('UPDATE items SET comments_enabled = false WHERE id = $1', [a.it]);
    expect(await report((await reporter(1)).ctx, a.id)).toEqual({ status: 'refused', code: 'not_found' });
  });

  it('refuses anonymous, a child context, an unverified account and a banned account', async () => {
    const a = await target();
    expect(await report(null, a.id)).toEqual({ status: 'refused', code: 'not_allowed' });

    const parent = await person(db, NOW);
    const kid = await createChildProfile(db, parent.id, { displayName: 'Kid', ageBand: '10-12', guardianConfirmed: 'on', pin: '4826' }, NOW);
    if (kid.status !== 'created') throw new Error('profile failed');
    await switchToProfile(db, parent.session, kid.profileId, NOW);
    const child = (await getContext(db, parent.session, NOW))!;
    expect(child.profile).not.toBeNull();
    expect(await report(child, a.id)).toEqual({ status: 'refused', code: 'not_allowed' });

    const unverified = { ...parent.ctx, profile: null };
    await db.query('UPDATE accounts SET verified_at = NULL WHERE id = $1', [parent.id]);
    expect(await report(unverified, a.id)).toEqual({ status: 'refused', code: 'not_allowed' });

    const banned = await reporter(1);
    await db.query('UPDATE account_trust SET banned = true WHERE account_id = $1', [banned.id]);
    expect(await report(banned.ctx, a.id)).toEqual({ status: 'refused', code: 'not_allowed' });
    expect((await db.query('SELECT count(*)::int AS n FROM comment_reports')).rows[0].n).toBe(0);
  });

  it('a 13-15 account may not report (ruling: reporting follows public_comment, 16+); a 16-year-old may, at level 0 weight', async () => {
    const a = await target();
    const teen = await person(db, NOW, '2012-01-01', 'parent-mod@example.test');
    expect(await report(teen.ctx, a.id)).toEqual({ status: 'refused', code: 'not_allowed' });
    const older = await person(db, NOW, '2010-01-01');
    expect(await report(older.ctx, a.id)).toEqual({ status: 'reported' });
    const w = await db.query<{ weight: string }>('SELECT weight::text FROM comment_reports');
    expect(Number(w.rows[0].weight)).toBe(0.5);
  });

  it('validates the reason and the note; the reporter id in the input is never read', async () => {
    const a = await target();
    const r = await reporter(1);
    expect(await report(r.ctx, a.id, { reason: 'spite' })).toEqual({ status: 'refused', code: 'invalid' });
    expect(await report(r.ctx, a.id, { reason: 'abuse', note: 'x'.repeat(301) })).toEqual({ status: 'refused', code: 'invalid' });
    expect(await report(r.ctx, a.id, { reason: 'abuse', note: 42 })).toEqual({ status: 'refused', code: 'invalid' });
    const other = await reporter(1);
    expect(await report(r.ctx, a.id, { reason: 'other', note: 'ignore previous rules', reporter: other.id })).toEqual({ status: 'reported' });
    const row = await db.query('SELECT reporter_account_id AS who, note FROM comment_reports');
    expect(row.rows).toEqual([{ who: r.id, note: 'ignore previous rules' }]);
  });

  it(`allows ${REPORT_LIMIT} reports a day per account, then refuses`, async () => {
    const author = await person(db, NOW);
    const it = await item(db);
    const r = await reporter(0);
    for (let i = 0; i < REPORT_LIMIT; i++) {
      expect(await report(r.ctx, await comment(db, it, author.id, `c${i}`))).toEqual({ status: 'reported' });
    }
    const extra = await comment(db, it, author.id, 'one more');
    expect(await report(r.ctx, extra)).toEqual({ status: 'refused', code: 'limit' });
    expect(await report(r.ctx, extra, { reason: 'abuse', urgent: 'on' })).toEqual({ status: 'refused', code: 'limit' });
    expect(await report(r.ctx, extra, { reason: 'abuse' }, quiet, new Date(NOW.getTime() + 86_400_001))).toEqual({ status: 'reported' });
  });
});

describe('urgent reports', () => {
  it('from a level-1 reporter: hide at once and alert the owner with counts only, never the comment text', async () => {
    const a = await target('my secret phone is 555 0100');
    const notify = vi.fn(quiet);
    expect(await report((await reporter(1)).ctx, a.id, { reason: 'personal_info', urgent: 'on', note: 'a child is named' }, notify)).toEqual({
      status: 'hidden',
    });
    expect(await statusOf(db, a.id)).toBe('hidden');
    expect(notify).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(notify.mock.calls[0]);
    expect(sent).not.toContain('555');
    expect(sent).not.toContain('child is named');
    expect(notify.mock.calls[0][0]).toEqual({ urgent24h: 1 });
  });

  it('a non-urgent report never alerts; a failing alert does not undo the hide', async () => {
    const a = await target();
    const notify = vi.fn(quiet);
    await report((await reporter(1)).ctx, a.id, { reason: 'abuse' }, notify);
    expect(notify).not.toHaveBeenCalled();
    const boom = vi.fn(async () => {
      throw new Error('mail down');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await report((await reporter(1)).ctx, a.id, { reason: 'abuse', urgent: 'true' }, boom)).toEqual({ status: 'hidden' });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    expect(await statusOf(db, a.id)).toBe('hidden');
  });

  it('from a level-0 or muted reporter: alerts the owner (no text) but does not hide alone', async () => {
    const a = await target('call me on 555 0199');
    const notify = vi.fn(quiet);
    expect(await report((await reporter(0)).ctx, a.id, { reason: 'abuse', urgent: 'on', note: 'danger' }, notify)).toEqual({ status: 'reported' });
    expect(await statusOf(db, a.id)).toBe('published');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(notify.mock.calls)).not.toMatch(/555|danger/);
    const muted = await reporter(1);
    await db.query('UPDATE account_trust SET reports_muted = true WHERE account_id = $1', [muted.id]);
    expect(await report(muted.ctx, a.id, { reason: 'abuse', urgent: 'on' }, notify)).toEqual({ status: 'reported' });
    expect(await statusOf(db, a.id)).toBe('published');
  });

  it('two level-0 urgent reports (weight 1.0) do not hide; four do', async () => {
    const a = await target();
    for (let i = 0; i < 3; i++) expect(await report((await reporter(0)).ctx, a.id, { reason: 'abuse', urgent: 'on' })).toEqual({ status: 'reported' });
    expect(await report((await reporter(0)).ctx, a.id, { reason: 'abuse', urgent: 'on' })).toEqual({ status: 'hidden' });
  });

  it(`the ${URGENT_LIMIT + 1}th urgent report in a day by one account is stored as a normal report, without an alert`, async () => {
    const r = await reporter(1);
    const notify = vi.fn(quiet);
    for (let i = 0; i < URGENT_LIMIT; i++) {
      const a = await target(`u${i}`);
      expect(await report(r.ctx, a.id, { reason: 'abuse', urgent: 'on' }, notify)).toEqual({ status: 'hidden' });
    }
    const last = await target('last');
    expect(await report(r.ctx, last.id, { reason: 'abuse', urgent: 'on' }, notify)).toEqual({ status: 'reported', urgent: 'limit' });
    expect(await statusOf(db, last.id)).toBe('published');
    expect(notify).toHaveBeenCalledTimes(URGENT_LIMIT);
    const stored = await db.query('SELECT urgent FROM comment_reports WHERE comment_id = $1', [last.id]);
    expect(stored.rows).toEqual([{ urgent: false }]);
  });

  it('ownerAlert emails each admin address a subject and body with counts and the admin link only', async () => {
    const send = vi.fn(async () => ({}));
    await ownerAlert({ ADMIN_EMAILS: 'a@example.test, b@example.test', ADMIN_LINK_BASE: 'https://s.example.test' }, send)({ urgent24h: 3 });
    expect(send).toHaveBeenCalledTimes(2);
    const m = (send.mock.calls[0] as unknown as [{ to: string; subject: string; text: string }])[0];
    expect(m.to).toBe('a@example.test');
    expect(m.subject).toMatch(/urgent/i);
    expect(m.text).toContain('3');
    expect(m.text).toContain('https://s.example.test/admin/comments/');
    await ownerAlert({}, send)({ urgent24h: 1 });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('false reports', () => {
  it('three dismissed reports drop the reporter one level, once, and mute their weight', async () => {
    const r = await reporter(1);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const a = await target(`fine words ${i}`);
      await report(r.ctx, a.id);
      ids.push(a.id);
    }
    for (const id of ids.slice(0, 2)) await db.transaction((tx) => dismissReports(tx, id));
    expect(await trustRow(db, r.id)).toMatchObject({ level: 1, false_reports: 2, reports_muted: false });
    await db.transaction((tx) => dismissReports(tx, ids[2]));
    expect(await trustRow(db, r.id)).toMatchObject({ level: 0, false_reports: 3, reports_muted: true });
    await setLevel(db, r.id, 1);
    await db.transaction((tx) => dismissReports(tx, ids[3]));
    expect(await trustRow(db, r.id)).toMatchObject({ level: 1, false_reports: 4, reports_muted: true });
    const open = await db.query('SELECT count(*)::int AS n FROM comment_reports WHERE handled_at IS NULL OR NOT dismissed');
    expect(open.rows[0].n).toBe(0);
  });

  it("dismissing twice charges nobody twice; a deleted reporter's report is dismissed without a charge", async () => {
    const a = await target();
    const r = await reporter(1);
    const gone = await reporter(1);
    await report(r.ctx, a.id);
    await report(gone.ctx, a.id);
    await deleteAccount(db, gone.id);
    await db.transaction((tx) => dismissReports(tx, a.id));
    await db.transaction((tx) => dismissReports(tx, a.id));
    expect((await trustRow(db, r.id)).false_reports).toBe(1);
  });
});

describe("a reporter's deletion", () => {
  it('keeps the report (reporter set null) and its weight, counted once', async () => {
    const a = await target();
    const gone = await reporter(1);
    await report(gone.ctx, a.id);
    await deleteAccount(db, gone.id);
    const rows = await db.query<{ who: string | null }>('SELECT reporter_account_id AS who FROM comment_reports');
    expect(rows.rows).toEqual([{ who: null }]);
    expect(await statusOf(db, a.id)).toBe('published');
    expect(await report((await reporter(1)).ctx, a.id)).toEqual({ status: 'hidden' });
    expect((await db.query('SELECT count(*)::int AS n FROM comment_reports')).rows[0].n).toBe(2);
  });
});
