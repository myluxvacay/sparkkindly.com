// @vitest-environment node
// The social admin (plan 5A Task 4) on PGlite: the four audited actions (platform switch/cap/time, hand-pick, retry,
// cancel) through runAction (session and CSRF are checked by /admin/act/ before it, tests/unit/admin-act.test.ts);
// caps 0 to 10 and times up to 20:00; hand-pick refuses Kids and ineligible items; retry only from failed and for one
// more attempt; with SOCIAL_ENABLED off every social action is unknown. The overview the page shows: statuses, skip
// reasons, links, errors, credentials as yes/no only, and visits.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { distribution, socialItem, statusOf } from '../helpers/social';
import { seedReference } from '@/db/seed';
import { runAction } from '@/lib/admin/actions';
import { socialOverview } from '@/lib/social/admin';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const ADMIN = { email: 'owner@example.test' };
const NOW = new Date('2026-11-05T12:00:00Z');

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  vi.stubEnv('SOCIAL_ENABLED', 'true');
  await db.query('DELETE FROM distributions');
  await db.query('DELETE FROM audit_log');
  await db.query("UPDATE social_platforms SET enabled = true, daily_cap = 3, post_time_utc = '12:00'");
});

const act = (name: string, fields: Record<string, string>) => runAction(db, ADMIN, name, new URLSearchParams(fields), NOW);
const audits = async () => (await db.query<{ action: string; target: string }>('SELECT action, target FROM audit_log ORDER BY id')).rows;
const platform = async (p: string) =>
  (await db.query<{ enabled: boolean; daily_cap: number; t: string }>('SELECT enabled, daily_cap, post_time_utc::text AS t FROM social_platforms WHERE platform = $1', [p])).rows[0];

describe('social.platform_set', () => {
  it('saves switch, cap and time, audited', async () => {
    expect(await act('social.platform_set', { platform: 'instagram', enabled: 'false', daily_cap: '5', post_time: '09:30' })).toMatchObject({ ok: true, code: 'social_platform_saved' });
    expect(await platform('instagram')).toEqual({ enabled: false, daily_cap: 5, t: '09:30:00' });
    expect(await audits()).toEqual([{ action: 'social.platform_set', target: 'social:instagram' }]);
  });

  it.each([
    ['cap 11', { daily_cap: '11' }],
    ['cap -1', { daily_cap: '-1' }],
    ['cap not a number', { daily_cap: 'two' }],
    ['time after 20:00', { post_time: '20:01' }],
    ['time malformed', { post_time: '9am' }],
    ['unknown platform', { platform: 'twitter' }],
  ])('refuses %s with no change and no audit', async (_, patch) => {
    const r = await act('social.platform_set', { platform: 'facebook', enabled: 'true', daily_cap: '2', post_time: '10:00', ...patch });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(await platform('facebook')).toMatchObject({ daily_cap: 3 });
    expect(await audits()).toEqual([]);
  });

  it('accepts cap 0 and 10, and 20:00', async () => {
    expect(await act('social.platform_set', { platform: 'facebook', enabled: 'true', daily_cap: '0', post_time: '20:00' })).toMatchObject({ ok: true });
    expect(await act('social.platform_set', { platform: 'facebook', enabled: 'true', daily_cap: '10', post_time: '00:00' })).toMatchObject({ ok: true });
  });
});

describe('social.pick', () => {
  it('hand-picks an eligible item, audited; refuses Kids, drafts and over-cap with a reason', async () => {
    const ok = await socialItem(db, { publishedAt: '2026-10-01T00:00:00Z' });
    expect(await act('social.pick', { item: ok, platform: 'instagram' })).toMatchObject({ ok: true, code: 'social_picked' });
    expect(await audits()).toEqual([{ action: 'social.pick', target: ok }]);
    for (const o of [{ world: 'kids' }, { audience: 'kids' }, { riskTier: 'kids' }, { status: 'draft' }]) {
      const id = await socialItem(db, o);
      expect(await act('social.pick', { item: id, platform: 'instagram' }), JSON.stringify(o)).toMatchObject({ ok: false, status: 409, code: 'social_ineligible' });
    }
    expect(await act('social.pick', { item: 'not-a-uuid', platform: 'instagram' })).toMatchObject({ ok: false, status: 400 });
    expect(await act('social.pick', { item: ok, platform: 'instagram' })).toMatchObject({ ok: false, code: 'social_exists' });
    await db.query("UPDATE social_platforms SET daily_cap = 1 WHERE platform = 'facebook'");
    await act('social.pick', { item: ok, platform: 'facebook' });
    expect(await act('social.pick', { item: await socialItem(db), platform: 'facebook' })).toMatchObject({ ok: false, code: 'social_cap' });
    await db.query("UPDATE social_platforms SET enabled = false WHERE platform = 'facebook'");
    expect(await act('social.pick', { item: await socialItem(db), platform: 'facebook' })).toMatchObject({ ok: false, code: 'social_platform' });
  });
});

describe('social.retry and social.cancel', () => {
  it('retry moves failed to scheduled now, for exactly one more attempt; anything else is refused', async () => {
    const id = await distribution(db, await socialItem(db), 'instagram', { status: 'failed', caption: 'x' });
    await db.query('UPDATE distributions SET attempts = 4 WHERE id = $1', [id]);
    expect(await act('social.retry', { id: String(id) })).toMatchObject({ ok: true, code: 'social_retried' });
    const r = (await db.query<{ status: string; attempts: number; scheduled_for: Date }>('SELECT status, attempts, scheduled_for FROM distributions WHERE id = $1', [id])).rows[0];
    expect(r).toMatchObject({ status: 'scheduled', attempts: 3 });
    expect(r.scheduled_for.toISOString()).toBe(NOW.toISOString());
    expect(await act('social.retry', { id: String(id) })).toMatchObject({ ok: false, status: 409, code: 'wrong_status' });
    const posted = await distribution(db, await socialItem(db), 'instagram', { status: 'posted', caption: 'x' });
    expect(await act('social.retry', { id: String(posted) })).toMatchObject({ ok: false, code: 'wrong_status' });
    expect(await audits()).toEqual([{ action: 'social.retry', target: `distribution:${id}` }]);
  });

  it('cancel works from selected, copy_ready, scheduled, failed and flagged, never from posted or posting', async () => {
    for (const s of ['selected', 'copy_ready', 'scheduled', 'failed', 'flagged']) {
      const id = await distribution(db, await socialItem(db), 'facebook', { status: s, caption: 'x' });
      expect(await act('social.cancel', { id: String(id) }), s).toMatchObject({ ok: true, code: 'social_cancelled' });
      expect(await statusOf(db, id)).toBe('cancelled');
    }
    for (const s of ['posted', 'posting']) {
      const id = await distribution(db, await socialItem(db), 'facebook', { status: s, caption: 'x' });
      expect(await act('social.cancel', { id: String(id) }), s).toMatchObject({ ok: false, code: 'wrong_status' });
    }
    expect(await act('social.cancel', { id: '999999' })).toMatchObject({ ok: false, status: 404 });
    expect(await act('social.cancel', { id: 'x' })).toMatchObject({ ok: false, status: 400 });
  });
});

describe('flag off', () => {
  it('every social action is unknown', async () => {
    vi.stubEnv('SOCIAL_ENABLED', '');
    for (const name of ['social.platform_set', 'social.pick', 'social.retry', 'social.cancel']) {
      expect(await act(name, {})).toMatchObject({ ok: false, status: 400, code: 'unknown_action' });
    }
  });
});

describe('socialOverview', () => {
  it('lists platforms with credentials as yes/no, recent distributions with reasons and links, and visits', async () => {
    const item = await socialItem(db, { title: 'Odd one out' });
    await distribution(db, item, 'instagram', { status: 'posted', caption: 'x', postedAt: '2026-11-05T11:00:00Z' });
    await db.query("UPDATE distributions SET post_url = 'https://www.instagram.com/p/abc/'");
    const skipped = await socialItem(db);
    await db.query("INSERT INTO distributions (item_id, platform, day, status, skip_reason) VALUES ($1, 'facebook', '2026-11-05', 'skipped', 'cap_reached')", [skipped]);
    await db.query("INSERT INTO social_visits (day, platform, item_id, visits) VALUES ('2026-11-05', 'instagram', $1, 7)", [item]);
    const env = { META_PAGE_ACCESS_TOKEN: 'SECRET-TOKEN', META_PAGE_ID: '111' };
    const o = await socialOverview(db, NOW, env);
    expect(o.platforms.find((p) => p.platform === 'facebook')).toMatchObject({ credentials: true, supported: true });
    expect(o.platforms.find((p) => p.platform === 'instagram')).toMatchObject({ credentials: false, supported: true });
    expect(o.platforms.find((p) => p.platform === 'tiktok')).toMatchObject({ supported: false });
    expect(o.distributions.find((d) => d.platform === 'instagram')).toMatchObject({ status: 'posted', title: 'Odd one out', postUrl: 'https://www.instagram.com/p/abc/' });
    expect(o.distributions.find((d) => d.platform === 'facebook')).toMatchObject({ status: 'skipped', skipReason: 'cap_reached' });
    expect(o.visits).toEqual([expect.objectContaining({ platform: 'instagram', title: 'Odd one out', visits: 7 })]);
    expect(JSON.stringify(o)).not.toContain('SECRET-TOKEN');
    expect(JSON.stringify(o)).not.toMatch(/META_/);
  });
});
