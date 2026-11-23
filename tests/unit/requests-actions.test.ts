// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { runAction } from '@/lib/admin/actions';
import { createRequest, getRequest } from '@/lib/requests/repo';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const ADMIN = { email: 'owner@example.test' };
const NOW = new Date('2026-11-23T12:00:00Z');
const HASH = 'd'.repeat(64);
const act = (name: string, fields: Record<string, string>) => runAction(db, ADMIN, name, new URLSearchParams(fields), NOW);

beforeAll(async () => { db = await newTestDb(); await seedReference(db); });
afterAll(async () => { await db.close(); });

describe('request admin actions (through runAction, with audit)', () => {
  it('approve moves pending → approved; a repeat is a conflict; decline then refuses', async () => {
    const r = await createRequest(db, { categoryTopic: 'printables-mazes', ageTopic: 'ages-5-8', requestText: 'A robot maze', submitterHash: HASH });
    expect(await act('request.approve', { id: r.id })).toMatchObject({ ok: true, code: 'approved' });
    expect((await getRequest(db, r.id))?.status).toBe('approved');
    expect(await act('request.approve', { id: r.id })).toMatchObject({ ok: false, status: 409 });
    expect(await act('request.decline', { id: r.id })).toMatchObject({ ok: true, code: 'rejected' });
    expect((await getRequest(db, r.id))?.status).toBe('declined');
    const audits = await db.query<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'request.%'");
    expect(audits.rows.map((a) => a.action)).toEqual(['request.approve', 'request.decline']);
  });

  it('mark-created demands an on-site path and refuses protocol-relative URLs', async () => {
    const r = await createRequest(db, { categoryTopic: 'printables-mazes', ageTopic: 'ages-5-8', requestText: 'A robot maze', submitterHash: HASH });
    expect(await act('request.create', { id: r.id, created_url: '//evil.example/x' })).toMatchObject({ ok: false, status: 400 });
    expect(await act('request.create', { id: r.id, created_url: 'https://evil.example/x' })).toMatchObject({ ok: false, status: 400 });
    expect(await act('request.create', { id: r.id, created_url: '/printables/paper-aeroplane-classic-dart/' })).toMatchObject({ ok: true, code: 'published' });
    expect((await getRequest(db, r.id))?.createdUrl).toBe('/printables/paper-aeroplane-classic-dart/');
  });

  it('an unknown id is not found; a malformed id is not found either', async () => {
    expect(await act('request.approve', { id: '123e4567-e89b-42d3-a456-426614174000' })).toMatchObject({ ok: false, status: 404 });
    expect(await act('request.approve', { id: 'not-a-uuid' })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('report admin actions (through runAction)', () => {
  it('fixed / not-a-mistake / duplicate each start from pending only', async () => {
    const w = await db.query<{ id: number }>("SELECT id FROM worlds WHERE slug = 'play'");
    const item = await db.query<{ id: string }>(
      `INSERT INTO items (world_id, kind, slug, title, summary, body, audience, status, published_at, created_by, risk_tier, approved_by)
       VALUES ($1,'article','rep-target','T','S','{}'::jsonb,'all','published','2026-10-31T00:00:00Z','test','computable','test') RETURNING id`,
      [w.rows[0].id],
    );
    const mk = async () => (await db.query<{ id: string }>("INSERT INTO problem_reports (item_id, reason) VALUES ($1, 'typo') RETURNING id::text", [item.rows[0].id])).rows[0].id;
    const a = await mk(); const b = await mk(); const c = await mk();
    expect(await act('report.fixed', { id: a })).toMatchObject({ ok: true, code: 'report_fixed' });
    expect(await act('report.fixed', { id: a })).toMatchObject({ ok: false, status: 409 });
    expect(await act('report.not-a-mistake', { id: b })).toMatchObject({ ok: true, code: 'report_not_a_mistake' });
    expect(await act('report.duplicate', { id: c })).toMatchObject({ ok: true, code: 'report_duplicate' });
    expect(await act('report.fixed', { id: '999999' })).toMatchObject({ ok: false, status: 404 });
  });
});
