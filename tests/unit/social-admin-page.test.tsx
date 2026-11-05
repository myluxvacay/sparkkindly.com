// @vitest-environment node
// The /admin/social/ view (plan 5A Task 4): statuses, skip reasons, links and errors, the "no credentials" banner for a
// switched-on platform without them, visits, and never a token. The social actions through /admin/act/ need a session
// and the CSRF token like every admin action.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { handleAdminAction } from '@/lib/admin/act';
import { newTotpSecret, totpAt } from '@/lib/admin/totp';
import { sealSecret, TEST_SECRET_KEY } from '@/lib/admin/secret-box';
import { consumeLink, csrfToken, requestLink, submitCode } from '@/lib/admin/sessions';
import SocialAdmin from '@/components/admin/SocialAdmin';
import type { Overview } from '@/lib/social/admin';

const NOW = new Date('2026-11-05T12:00:00Z');
const OWNER = 'owner@example.test';
const env = { ADMIN_EMAILS: OWNER, ADMIN_SECRET_KEY: TEST_SECRET_KEY };

const overview: Overview = {
  platforms: [
    { platform: 'instagram', enabled: true, dailyCap: 2, postTime: '12:00', supported: true, credentials: false },
    { platform: 'facebook', enabled: true, dailyCap: 3, postTime: '13:00', supported: true, credentials: true },
    { platform: 'tiktok', enabled: false, dailyCap: 1, postTime: '15:00', supported: false, credentials: false },
    { platform: 'youtube', enabled: false, dailyCap: 1, postTime: '16:00', supported: false, credentials: false },
  ],
  distributions: [
    { id: 1, platform: 'facebook', day: '2026-11-05', status: 'posted', skipReason: null, title: 'Odd one out', world: 'play', slug: 'odd', link: 'https://sparkkindly.com/play/odd/?utm_source=facebook&utm_medium=social&utm_campaign=play-odd', postUrl: 'https://www.facebook.com/111_9', lastError: null, scheduledFor: NOW, postedAt: NOW, attempts: 1 },
    { id: 2, platform: 'instagram', day: '2026-11-05', status: 'skipped', skipReason: 'world_rotation', title: 'Second', world: 'grow', slug: 'second', link: null, postUrl: null, lastError: null, scheduledFor: null, postedAt: null, attempts: 0 },
    { id: 3, platform: 'facebook', day: '2026-11-05', status: 'failed', skipReason: null, title: 'Third', world: 'grow', slug: 'third', link: null, postUrl: null, lastError: 'Meta answered HTTP 400 (code 100)', scheduledFor: NOW, postedAt: null, attempts: 1 },
    { id: 4, platform: 'facebook', day: '2026-11-04', status: 'flagged', skipReason: null, title: 'Fourth', world: 'grow', slug: 'fourth', link: null, postUrl: 'https://www.facebook.com/111_8', lastError: 'item unpublished after posting: remove manually from the platform', scheduledFor: null, postedAt: NOW, attempts: 1 },
  ],
  visits: [{ platform: 'facebook', title: 'Odd one out', world: 'play', slug: 'odd', visits: 7 }],
};

describe('SocialAdmin view', () => {
  const html = renderToStaticMarkup(<SocialAdmin csrf="CSRF" overview={overview} />);

  it('shows statuses, skip reasons, the post link and errors', () => {
    expect(html).toContain('Odd one out');
    expect(html).toMatch(/posted/);
    expect(html).toContain('href="https://www.facebook.com/111_9"');
    expect(html).toMatch(/another world.{1,6}s turn/i);
    expect(html).toContain('Meta answered HTTP 400 (code 100)');
    expect(html).toMatch(/remove manually from the platform/);
  });

  it('shows "no credentials" for a switched-on supported platform without them, and nothing secret', () => {
    expect(html).toMatch(/no credentials[^<]*Instagram/i);
    expect(html).not.toMatch(/no credentials[^<]*Facebook/i);
    expect(html).not.toMatch(/token=|access_token|EAA/);
  });

  it('offers retry on failed and cancel on pending or failed rows only', () => {
    expect(html).toContain('aria-label="Retry: Third on facebook"');
    expect(html).toContain('aria-label="Cancel: Third on facebook"');
    expect(html).not.toContain('Retry: Odd one out');
    expect(html).not.toContain('Cancel: Odd one out');
  });

  it('5A review M1: a flagged row offers "Keep as posted" and Cancel, never Retry', () => {
    expect(html).toContain('aria-label="Keep as posted: Fourth on facebook"');
    expect(html).toContain('aria-label="Cancel: Fourth on facebook"');
    expect(html).not.toContain('Retry: Fourth');
  });

  it('5B review M1: an unusable token store says so plainly', () => {
    const yt = { platform: 'youtube' as const, enabled: true, dailyCap: 1, postTime: '16:00', supported: true, credentials: false, tokenStore: 'unavailable' as const };
    const out = renderToStaticMarkup(<SocialAdmin csrf="CSRF" overview={{ ...overview, platforms: [yt] }} />);
    expect(out).toMatch(/YouTube: token store unavailable/);
  });

  it('plan 5B: a video platform waiting for re-authorisation says so', () => {
    const tiktok = { platform: 'tiktok' as const, enabled: true, dailyCap: 1, postTime: '15:00', supported: true, credentials: false, reauth: true };
    const out = renderToStaticMarkup(<SocialAdmin csrf="CSRF" overview={{ ...overview, platforms: [tiktok] }} />);
    expect(out).toMatch(/TikTok needs re-authorisation/);
    expect(out).toMatch(/href="\/admin\/social\/videos\/?"/);
  });

  it('shows visits per platform per item', () => {
    expect(html).toMatch(/Odd one out[^<]*<\/a>[^<]*facebook[^<]*7 visits/);
  });
});

describe('social actions through /admin/act/', () => {
  let db: Awaited<ReturnType<typeof newTestDb>>;
  let session: string;
  beforeAll(async () => {
    db = await newTestDb();
    await seedReference(db);
    const secret = newTotpSecret();
    await db.query('INSERT INTO admin_users (email, totp_secret) VALUES ($1, $2)', [OWNER, sealSecret(secret, OWNER, env)]);
    const first = (await consumeLink(db, (await requestLink(db, OWNER, env, NOW))!, env, NOW))!;
    session = (await submitCode(db, first, totpAt(secret, Math.floor(NOW.getTime() / 30_000)), env, NOW)).session!;
  });
  afterAll(async () => {
    await db.close();
  });

  it('need a session and the CSRF token', async () => {
    vi.stubEnv('SOCIAL_ENABLED', 'true');
    const post = (fields: Record<string, string>, cookie?: string) =>
      handleAdminAction(
        new Request('http://localhost/admin/act/', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            host: 'sparkkindly.com',
            origin: 'https://sparkkindly.com',
            ...(cookie ? { cookie: `__Host-sk_admin=${cookie}` } : {}),
          },
          body: new URLSearchParams({ action: 'social.platform_set', platform: 'instagram', enabled: 'true', daily_cap: '4', post_time: '10:00', return: '/admin/social/', ...fields }).toString(),
        }),
        { db, env, now: NOW },
      );
    expect((await post({})).headers.get('location')).toBe('/admin/sign-in/');
    expect((await post({ csrf: 'wrong' }, session)).status).toBe(403);
    expect((await db.query("SELECT daily_cap FROM social_platforms WHERE platform = 'instagram'")).rows[0]).toEqual({ daily_cap: 2 });
    expect((await post({ csrf: csrfToken(session) }, session)).headers.get('location')).toBe('/admin/social/?done=social_platform_saved');
    expect((await db.query("SELECT action FROM audit_log WHERE action = 'social.platform_set'")).rows).toHaveLength(1);
    vi.unstubAllEnvs();
  });
});
