// @vitest-environment node
// The owner's side of comment moderation (plan 7B Task 3): the queue in /admin/comments/ (escalations, appeals, urgent
// reports, muted reporters, counts, response targets), the four owner actions and the digest counts. No email or
// account id is ever shown; the digest carries counts only.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { newTestDb } from '../helpers/test-db';
import { comment, item, person, setLevel, statusOf, trustRow } from '../helpers/comments';
import { seedReference } from '@/db/seed';
import type { EmailMessage } from '@/lib/email';
import { runAction } from '@/lib/admin/actions';
import { buildDigest, renderDigest } from '@/lib/admin/digest';
import { ownerQueue } from '@/lib/comments/owner-queue';
import { reportComment } from '@/lib/comments/reports';
import { moderationQueue } from '@/lib/comments/moderation';
import CommentQueue from '@/components/admin/CommentQueue';
import { AUTHOR_REASONS } from '@/lib/comments/rejection-email';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const NOW = new Date('2026-11-05T12:00:00Z');
const admin = { email: 'owner@example.test' };
let sent: EmailMessage[] = [];
const send = async (m: EmailMessage) => void sent.push(m);
const act = (name: string, fields: Record<string, string>) => runAction(db, admin, name, new URLSearchParams(fields), NOW, send);

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  sent = [];
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('COMMENTS_ENABLED', 'true');
  await db.query('DELETE FROM accounts');
  await db.query('DELETE FROM items');
  await db.query('DELETE FROM audit_log');
});

async function decided(status: string, reason: string, body = 'words for the owner') {
  const author = await person(db, NOW);
  await setLevel(db, author.id, 0);
  await db.query('UPDATE account_trust SET rejected = 1 WHERE account_id = $1', [author.id]);
  const id = await comment(db, await item(db, 'play', 'Owner item'), author.id, body, status);
  await db.query("UPDATE comments SET moderation_reason = $2, decided_by = 'agent:moderator' WHERE id = $1", [id, reason]);
  return { author, id };
}
const escalated = async () => {
  const c = await decided('held', 'Unsure: may name a child', 'escalated words');
  await db.query('UPDATE comments SET escalated_at = $2 WHERE id = $1', [c.id, NOW]);
  return c;
};
const appealed = async () => {
  const c = await decided('rejected', 'Personal attack', 'appealed words');
  await db.query("INSERT INTO comment_appeals (comment_id, account_id, note, created_at) VALUES ($1, $2, 'I was joking', $3)", [c.id, c.author.id, NOW]);
  return c;
};

describe('ownerQueue and the page section', () => {
  it('lists escalations, appeals and urgent reports with text and reasons, but no email or account id', async () => {
    const e = await escalated();
    const a = await appealed();
    const u = await decided('published', '', 'urgent words');
    const reporter = await person(db, NOW);
    await setLevel(db, reporter.id, 1);
    await reportComment(db, reporter.ctx, u.id, { reason: 'personal_info', urgent: 'on', note: 'names a child' }, NOW, async () => {});
    const q = await ownerQueue(db, NOW);
    expect(q.escalations).toEqual([expect.objectContaining({ id: e.id, body: 'escalated words', reason: 'Unsure: may name a child', itemTitle: 'Owner item' })]);
    expect(q.appeals).toEqual([expect.objectContaining({ id: a.id, body: 'appealed words', reason: 'Personal attack', note: 'I was joking' })]);
    expect(q.urgent).toEqual([expect.objectContaining({ id: u.id, body: 'urgent words', reports: 1, status: 'hidden' })]);
    expect(q.counts).toMatchObject({ escalated: 1, appealsOpen: 1, urgent24h: 1 });
    const html = renderToStaticMarkup(<CommentQueue queue={q} csrf="t" />);
    for (const p of [e.author, a.author, u.author, reporter]) {
      expect(JSON.stringify(q)).not.toContain(p.email);
      expect(JSON.stringify(q)).not.toContain(p.id);
      expect(html).not.toContain(p.email);
    }
    expect(html).toContain('within 48 hours');
    expect(html).toContain('within 24 hours');
    expect(html).toContain('comments.appeal_overturn');
  });

  it('lists muted reporters by an opaque report number only', async () => {
    const r = await person(db, NOW);
    await setLevel(db, r.id, 0);
    await db.query('UPDATE account_trust SET reports_muted = true, false_reports = 3 WHERE account_id = $1', [r.id]);
    const c = await decided('published', '');
    await db.query("INSERT INTO comment_reports (comment_id, reporter_account_id, reason, weight, handled_at, dismissed) VALUES ($1, $2, 'abuse', 0, $3, true)", [
      c.id,
      r.id,
      NOW,
    ]);
    const q = await ownerQueue(db, NOW);
    expect(q.muted).toEqual([{ report: expect.any(String), falseReports: 3 }]);
    expect(JSON.stringify(q.muted)).not.toContain(r.id);
  });
});

describe('owner actions', () => {
  it('appeal overturn publishes, reverses the count, emails the author after the commit and is audited', async () => {
    const a = await appealed();
    expect(await act('comments.appeal_overturn', { comment: a.id })).toMatchObject({ ok: true, code: 'comments_appeal_overturned' });
    expect(await statusOf(db, a.id)).toBe('published');
    expect((await trustRow(db, a.author.id)).rejected).toBe(0);
    expect(sent.map((m) => m.to)).toEqual([a.author.email]);
    const audit = await db.query('SELECT actor, action, target FROM audit_log');
    expect(audit.rows).toEqual([{ actor: admin.email, action: 'comments.appeal_overturn', target: `comment:${a.id}` }]);
    expect(await act('comments.appeal_uphold', { comment: a.id })).toMatchObject({ ok: false, status: 409 });
    expect(sent).toHaveLength(1);
  });

  it('appeal uphold keeps the decision and emails the author; unknown appeals are not found', async () => {
    const a = await appealed();
    expect(await act('comments.appeal_uphold', { comment: a.id })).toMatchObject({ ok: true, code: 'comments_appeal_upheld' });
    expect(await statusOf(db, a.id)).toBe('rejected');
    expect(sent.map((m) => m.to)).toEqual([a.author.email]);
    expect(await act('comments.appeal_uphold', { comment: '00000000-0000-4000-8000-000000000000' })).toMatchObject({ ok: false, status: 404 });
  });

  it('escalation resolve: publish counts an approval; remove rejects, drops trust and emails the author with the reason', async () => {
    const e1 = await escalated();
    expect(await act('comments.escalation_resolve', { comment: e1.id, outcome: 'publish' })).toMatchObject({ ok: true });
    expect(await statusOf(db, e1.id)).toBe('published');
    expect((await trustRow(db, e1.author.id)).approved).toBe(1);
    expect(sent).toEqual([]);
    const e2 = await escalated();
    expect(await act('comments.escalation_resolve', { comment: e2.id, outcome: 'remove' })).toMatchObject({ ok: true });
    expect(await statusOf(db, e2.id)).toBe('rejected');
    expect((await trustRow(db, e2.author.id)).rejected).toBe(2);
    expect(sent.map((m) => m.to)).toEqual([e2.author.email]);
    expect(sent[0].text).not.toContain('Unsure: may name a child');
    expect(sent[0].text).toContain(AUTHOR_REASONS.other);
    expect(await act('comments.escalation_resolve', { comment: e2.id, outcome: 'publish' })).toMatchObject({ ok: false, status: 409 });
    expect(await act('comments.escalation_resolve', { comment: e1.id, outcome: 'maybe' })).toMatchObject({ ok: false, status: 400 });
    expect((await ownerQueue(db, NOW)).escalations).toEqual([]);
  });

  it("a muted reporter's urgent report leaves the comment published; the owner can still remove it (7B review H1)", async () => {
    const u = await decided('published', '', 'muted urgent words');
    await db.query('UPDATE comments SET moderation_reason = NULL WHERE id = $1', [u.id]);
    const r = await person(db, NOW);
    await setLevel(db, r.id, 1);
    await db.query('UPDATE account_trust SET reports_muted = true WHERE account_id = $1', [r.id]);
    await reportComment(db, r.ctx, u.id, { reason: 'abuse', urgent: 'on' }, NOW, async () => {});
    expect(await statusOf(db, u.id)).toBe('published');
    const q = await ownerQueue(db, NOW);
    const html = renderToStaticMarkup(<CommentQueue queue={q} csrf="t" />);
    expect(html).toMatch(/Remove: urgent report 1/);
    expect(await act('comments.escalation_resolve', { comment: u.id, outcome: 'remove' })).toMatchObject({ ok: true });
    expect(await statusOf(db, u.id)).toBe('hidden');
    expect(sent.map((m) => m.to)).toEqual([u.author.email]);
  });

  it("the owner can also publish (keep) a comment a muted reporter urgently reported; it never entered the agent queue", async () => {
    const u = await decided('published', '', 'muted publish words');
    await db.query('UPDATE comments SET moderation_reason = NULL WHERE id = $1', [u.id]);
    const r = await person(db, NOW);
    await setLevel(db, r.id, 1);
    await db.query('UPDATE account_trust SET reports_muted = true WHERE account_id = $1', [r.id]);
    await reportComment(db, r.ctx, u.id, { reason: 'abuse', urgent: 'on' }, NOW, async () => {});
    expect((await moderationQueue(db, NOW)).map((e) => e.id)).not.toContain(u.id);
    expect((await ownerQueue(db, NOW)).urgent.map((e) => e.id)).toContain(u.id);
    expect(await act('comments.escalation_resolve', { comment: u.id, outcome: 'publish' })).toMatchObject({ ok: true });
    expect(await statusOf(db, u.id)).toBe('published');
    const open = await db.query('SELECT count(*)::int AS n FROM comment_reports WHERE comment_id = $1 AND handled_at IS NULL', [u.id]);
    expect(open.rows[0].n).toBe(0);
  });

  it('resolve applies only to escalated comments or open urgent reports (L3)', async () => {
    const plain = await decided('hidden', 'Personal attack', 'already hidden words');
    expect(await act('comments.escalation_resolve', { comment: plain.id, outcome: 'remove' })).toMatchObject({ ok: false, status: 409 });
    expect(await act('comments.escalation_resolve', { comment: plain.id, outcome: 'publish' })).toMatchObject({ ok: false, status: 409 });
    const quiet = await decided('published', '', 'quiet words');
    expect(await act('comments.escalation_resolve', { comment: quiet.id, outcome: 'remove' })).toMatchObject({ ok: false, status: 409 });
    expect(sent).toEqual([]);
  });

  it('publishing a comment with an open appeal closes the appeal as overturned and emails the outcome (L3)', async () => {
    const e = await escalated();
    await db.query("UPDATE comments SET status = 'hidden' WHERE id = $1", [e.id]);
    await db.query("INSERT INTO comment_appeals (comment_id, account_id, note, created_at) VALUES ($1, $2, 'please', $3)", [e.id, e.author.id, NOW]);
    expect(await act('comments.escalation_resolve', { comment: e.id, outcome: 'publish' })).toMatchObject({ ok: true });
    const ap = await db.query<{ outcome: string }>('SELECT outcome FROM comment_appeals WHERE comment_id = $1', [e.id]);
    expect(ap.rows[0].outcome).toBe('overturn');
    expect((await trustRow(db, e.author.id)).rejected).toBe(0);
    expect(sent.map((m) => m.to)).toEqual([e.author.email]);
    expect(sent[0].subject).toMatch(/appeal/i);
  });

  it("the agent's escalation note never reaches the author; the owner picks the author's sentence from the closed list (M1)", async () => {
    const author = await person(db, NOW);
    await setLevel(db, author.id, 0);
    const id = await comment(db, await item(db, 'play', 'Owner item'), author.id, 'note words', 'held');
    await db.query(
      "UPDATE comments SET escalated_at = $2, escalation_note = 'Reporter Jo says a child named Mia at Elm School is shown' WHERE id = $1",
      [id, NOW],
    );
    const q = await ownerQueue(db, NOW);
    expect(q.escalations[0].note).toMatch(/Elm School/);
    expect(await act('comments.escalation_resolve', { comment: id, outcome: 'remove', code: 'personal_info' })).toMatchObject({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).not.toMatch(/Jo|Mia|Elm School|child named/);
    expect(sent[0].text).toContain(AUTHOR_REASONS.personal_info);
    expect(await act('comments.escalation_resolve', { comment: id, outcome: 'remove', code: 'made-up' })).toMatchObject({ ok: false, status: 400 });
  });

  it('report reset unmutes the reporter of that report and clears their false reports', async () => {
    const r = await person(db, NOW);
    await setLevel(db, r.id, 0);
    await db.query('UPDATE account_trust SET reports_muted = true, false_reports = 3 WHERE account_id = $1', [r.id]);
    const c = await decided('published', '');
    const rep = await db.query<{ id: string }>(
      "INSERT INTO comment_reports (comment_id, reporter_account_id, reason, weight) VALUES ($1, $2, 'abuse', 0) RETURNING id::text",
      [c.id, r.id],
    );
    expect(await act('comments.report_reset', { report: rep.rows[0].id })).toMatchObject({ ok: true, code: 'comments_reports_reset' });
    expect(await trustRow(db, r.id)).toMatchObject({ false_reports: 0, reports_muted: false });
    expect(await act('comments.report_reset', { report: '999999' })).toMatchObject({ ok: false, status: 404 });
  });

  it('with the comment flags off the comment actions are refused as unknown', async () => {
    vi.stubEnv('COMMENTS_ENABLED', '');
    const a = await appealed();
    expect(await act('comments.appeal_overturn', { comment: a.id })).toMatchObject({ ok: false, code: 'unknown_action' });
    expect(await statusOf(db, a.id)).toBe('rejected');
  });
});

describe('digest counts', () => {
  it('counts held, published and rejected by the agent, escalated, open appeals and urgent reports; never comment text', async () => {
    await decided('held', '', 'held secret words');
    const p = await decided('published', '', 'published secret words');
    await db.query("INSERT INTO audit_log (actor, action, target, at) VALUES ('agent:moderator', 'comment.approve', $1, $2)", [`comment:${p.id}`, NOW]);
    await db.query("INSERT INTO audit_log (actor, action, target, at) VALUES ('agent:moderator', 'comment.reject', 'comment:x', $1)", [NOW]);
    await escalated();
    await appealed();
    const d = await buildDigest(db, NOW);
    expect(d.comments).toEqual({ held: 1, publishedByAgent: 1, rejectedByAgent: 1, escalated: 1, appealsOpen: 1, urgent24h: 0 });
    const { text } = renderDigest(d);
    expect(text).toContain('Comments');
    expect(text).toContain('Held, waiting for the moderation agent: 1');
    expect(text).not.toMatch(/secret words|escalated words|appealed words|I was joking/);
  });
});
