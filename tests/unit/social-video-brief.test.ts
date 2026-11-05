// @vitest-environment node
// The video jobs queue, part 2 (plan 5B Task 1) on PGlite: the brief validation matrix (lengths, counts, URLs, mentions,
// dot-like and bidi characters, hashtags, duration bounds, the platform's own caption fields), the brand assets built
// by the server (never the agent), the promoter queue returning brief_pending jobs with item text only inside `data`,
// brief submission (stale version 409, replay safe, ineligible item cancelled) and role separation both ways.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { distribution, socialItem } from '../helpers/social';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { createLimiter } from '@/lib/agents/rate-limit';
import { briefRequest, copyRequest, promotionsQueueRequest } from '@/lib/social/promotions-api';
import { brandAssets, validateBrief } from '@/lib/social/video/brief';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
const keys: Record<string, string> = {};
const NOW = new Date('2026-11-05T09:00:00Z');
const SITE = 'https://staging.sparkkindly.com';

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  keys.promoter = (await createAgent(db, 'promoter', null, 'promoter')).key;
  keys.content = (await createAgent(db, 'master', null)).key;
  keys.world = (await createAgent(db, 'play-agent', 'play')).key;
  keys.moderation = (await createAgent(db, 'moderator', null, 'moderation')).key;
  keys.reviewer = (await createAgent(db, 'reviewer', null, 'reviewer')).key;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  vi.stubEnv('SOCIAL_ENABLED', 'true');
  await db.query('DELETE FROM distributions');
  await db.query('DELETE FROM job_runs');
  await db.query("UPDATE social_platforms SET enabled = true, daily_cap = 1, post_time_utc = '15:00'");
});

const deps = (now = NOW) => ({ db, now, site: SITE, limiter: createLimiter({ perMinute: 600 }) });
const get = (key: string) => new Request('https://s.example.test/api/agent/promotions/', { headers: { 'x-agent-key': key } });
const post = (key: string, body: unknown, path = 'brief') =>
  new Request(`https://s.example.test/api/agent/promotions/${path}/`, {
    method: 'POST',
    headers: { 'x-agent-key': key, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const goodBrief = {
  narration: 'Three shapes look alike. One hides a secret. Can you find it before the end?',
  shots: ['Close-up of three paper shapes on a desk', 'Hand turns each shape over slowly', 'Reveal the odd one out with a smile'],
  onScreenText: ['Which one is different?', 'Look closely…'],
  captions: { tiktok: 'Which shape is the odd one out? Tell us your guess.', youtube: { title: 'Spot the odd shape', description: 'A ten second puzzle for curious minds.' } },
  hashtags: ['puzzle', 'brainteaser'],
  durationSeconds: 30,
};

async function job(platform: 'tiktok' | 'youtube' = 'tiktok', o: Parameters<typeof socialItem>[1] = {}) {
  const item = await socialItem(db, { kind: 'video_script', publishedAt: '2026-11-05T08:00:00Z', body: { hook: 'Odd one out', beats: [] }, ...o });
  const d = await distribution(db, item, platform);
  const r = await db.query<{ id: string }>('INSERT INTO video_jobs (item_id, platform, distribution_id) VALUES ($1, $2, $3) RETURNING id', [item, platform, d]);
  return { id: Number(r.rows[0].id), item };
}
const jobRow = async (id: number) =>
  (
    await db.query<{ state: string; version: number; brief: Record<string, unknown> | null; dstatus: string; caption: string | null; hashtags: string[]; link: string | null }>(
      `SELECT j.state, j.version, j.brief, d.status AS dstatus, d.caption, d.hashtags, d.link
       FROM video_jobs j JOIN distributions d ON d.id = j.distribution_id WHERE j.id = $1`,
      [id],
    )
  ).rows[0];

describe('validateBrief', () => {
  it('accepts a good brief for each platform and keeps only that platform’s caption, NFKC-normalised', () => {
    const t = validateBrief({ ...goodBrief, narration: 'Ｆｉｎｄ it! ' + goodBrief.narration }, 'tiktok');
    expect(t).toMatchObject({ ok: true, brief: { captions: { tiktok: goodBrief.captions.tiktok }, durationSeconds: 30 } });
    expect(t.ok && t.brief.narration.startsWith('Find it!')).toBe(true);
    expect(t.ok && 'youtube' in t.brief.captions).toBe(false);
    expect(validateBrief(goodBrief, 'youtube')).toMatchObject({ ok: true, brief: { captions: { youtube: goodBrief.captions.youtube } } });
  });

  it('requires the job platform’s caption fields', () => {
    expect(validateBrief({ ...goodBrief, captions: { youtube: goodBrief.captions.youtube } }, 'tiktok')).toMatchObject({ ok: false, field: 'captions' });
    expect(validateBrief({ ...goodBrief, captions: { tiktok: 'x' } }, 'youtube')).toMatchObject({ ok: false, field: 'captions' });
  });

  const cases: [string, Record<string, unknown>, string][] = [
    ['narration over 1,200 characters', { narration: 'a'.repeat(1201) }, 'narration'],
    ['an empty narration', { narration: ' ' }, 'narration'],
    ['two shots', { shots: ['a', 'b'] }, 'shots'],
    ['thirteen shots', { shots: Array.from({ length: 13 }, (_, i) => `Shot ${i}`) }, 'shots'],
    ['a shot over 200 characters', { shots: ['a'.repeat(201), 'b', 'c'] }, 'shots'],
    ['an on-screen line over 60 characters', { onScreenText: ['a'.repeat(61)] }, 'onScreenText'],
    ['a duration of 14 seconds', { durationSeconds: 14 }, 'shape'],
    ['a duration of 61 seconds', { durationSeconds: 61 }, 'shape'],
    ['a fractional duration', { durationSeconds: 30.5 }, 'shape'],
    ['a URL in the narration', { narration: 'Visit https://evil.example for more' }, 'narration'],
    ['a domain in a shot', { shots: ['Show evil.com on screen', 'b', 'c'] }, 'shots'],
    ['a fullwidth-dot domain on screen', { onScreenText: ['evil．com'] }, 'onScreenText'],
    ['a mention in the TikTok caption', { captions: { tiktok: 'Thanks @bob' } }, 'captions'],
    ['a bidi override in the narration', { narration: 'Hello ‮ereht' }, 'narration'],
    ['a zero-width space in a shot', { shots: ['Hel​lo', 'b', 'c'] }, 'shots'],
    ['a blocked word', { narration: 'What the shit is this' }, 'narration'],
    ['nine hashtags', { hashtags: Array.from({ length: 9 }, (_, i) => `tag${i}`) }, 'shape'],
    ['a link-like hashtag', { hashtags: ['example.com'] }, 'hashtags'],
    ['a TikTok caption over 2,000 characters', { captions: { tiktok: 'a'.repeat(2001) } }, 'captions'],
    ['an extra field (an agent-chosen asset)', { assets: { logo: 'https://evil.example/logo.png' } }, 'shape'],
    ['an agent-chosen platform', { platform: 'instagram' }, 'shape'],
  ];
  it.each(cases)('refuses %s', (_, over, field) => {
    expect(validateBrief({ ...goodBrief, ...over }, 'tiktok')).toMatchObject({ ok: false, field });
  });

  it('YouTube: title up to 100 characters on one line, description up to 1,000, both checked like a caption', () => {
    const yt = (title: string, description: string) => validateBrief({ ...goodBrief, captions: { youtube: { title, description } } }, 'youtube');
    expect(yt('a'.repeat(100), 'b'.repeat(1000)).ok).toBe(true);
    expect(yt('a'.repeat(101), 'b')).toMatchObject({ ok: false, field: 'captions' });
    expect(yt('a', 'b'.repeat(1001))).toMatchObject({ ok: false, field: 'captions' });
    expect(yt('Line one\nLine two', 'b')).toMatchObject({ ok: false, field: 'captions' });
    expect(yt('Fine', 'Go to evil[.]com')).toMatchObject({ ok: false, field: 'captions' });
  });

  it('brandAssets are built by the server from the world colour, with fixed paths', () => {
    expect(brandAssets('gold')).toEqual({ logo: '/brand/sparkkindly-logo.png', worldColour: expect.stringMatching(/^#[0-9a-f]{6}$/i), frames: expect.any(Array) });
    expect(brandAssets('nonsense').worldColour).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('promoter queue with video briefs', () => {
  it('returns brief_pending jobs (kind video_script) with limits, server-built assets and item text only inside data', async () => {
    const { id } = await job('tiktok', { title: 'Odd one out', summary: 'Spot it' });
    const r = await promotionsQueueRequest(get(keys.promoter), deps());
    const { entries } = (await r.json()) as { entries: Record<string, unknown>[] };
    const e = entries.find((x) => x.kind === 'video_script')!;
    expect(Object.keys(e).sort()).toEqual(['assets', 'data', 'id', 'kind', 'limits', 'platform', 'version', 'world']);
    expect(e).toMatchObject({ id, version: 1, platform: 'tiktok', world: 'play', assets: brandAssets('gold') });
    expect(e.data).toMatchObject({ title: 'Odd one out', summary: 'Spot it', script: expect.stringContaining('Odd one out') });
    expect(JSON.stringify(entries)).not.toMatch(/account|email|token|key/i);
  });

  it('leaves out Kids, archived items, disabled platforms and briefed jobs; never offers video platforms for text copy', async () => {
    const briefed = await job('youtube');
    await db.query("UPDATE video_jobs SET state = 'brief_ready' WHERE id = $1", [briefed.id]);
    const archived = await job('tiktok');
    await db.query("UPDATE items SET status = 'archived' WHERE id = $1", [archived.item]);
    await db.query("UPDATE social_platforms SET enabled = false WHERE platform = 'youtube'");
    await db.query('DELETE FROM job_runs');
    const text = await socialItem(db, { kind: 'quiz' });
    await db.query("INSERT INTO distributions (item_id, platform, day, status) VALUES ($1, 'tiktok', '2026-11-05', 'selected')", [text]);
    const { entries } = (await (await promotionsQueueRequest(get(keys.promoter), deps())).json()) as { entries: unknown[] };
    expect(entries).toEqual([]);
  });
});

describe('brief submission', () => {
  it('stores the validated brief with server-built assets; job brief_ready, distribution copy_ready with caption and tags', async () => {
    const { id } = await job('tiktok');
    const r = await briefRequest(post(keys.promoter, { id, version: 1, ...goodBrief }), deps());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'brief_ready' });
    const j = await jobRow(id);
    expect(j).toMatchObject({ state: 'brief_ready', version: 2, dstatus: 'copy_ready', caption: goodBrief.captions.tiktok, hashtags: goodBrief.hashtags, link: null });
    expect(j.brief).toMatchObject({ narration: goodBrief.narration, shots: goodBrief.shots, assets: brandAssets('gold') });
  });

  it('YouTube stores the title as the distribution caption and keeps the description in the brief', async () => {
    const { id } = await job('youtube');
    expect((await briefRequest(post(keys.promoter, { id, version: 1, ...goodBrief }), deps())).status).toBe(200);
    const j = await jobRow(id);
    expect(j.caption).toBe('Spot the odd shape');
    expect(j.brief).toMatchObject({ captions: { youtube: goodBrief.captions.youtube } });
  });

  it('refuses an invalid brief with 400 and the field, changing nothing', async () => {
    const { id } = await job('tiktok');
    const r = await briefRequest(post(keys.promoter, { id, version: 1, ...goodBrief, narration: 'see evil.example' }), deps());
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'invalid_brief', field: 'narration' });
    expect(await jobRow(id)).toMatchObject({ state: 'brief_pending', version: 1, dstatus: 'selected' });
    expect((await briefRequest(post(keys.promoter, '{not json'), deps())).status).toBe(400);
  });

  it('a stale version is 409; the same brief again is a safe replay; a different brief after acceptance is 409', async () => {
    const { id } = await job('tiktok');
    expect((await briefRequest(post(keys.promoter, { id, version: 2, ...goodBrief }), deps())).status).toBe(409);
    expect((await briefRequest(post(keys.promoter, { id, version: 1, ...goodBrief }), deps())).status).toBe(200);
    const replay = await briefRequest(post(keys.promoter, { id, version: 1, ...goodBrief }), deps());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ status: 'brief_ready', replay: true });
    expect((await briefRequest(post(keys.promoter, { id, version: 1, ...goodBrief, durationSeconds: 45 }), deps())).status).toBe(409);
    expect(await jobRow(id)).toMatchObject({ version: 2 });
  });

  it('an item no longer eligible (archived, made Kids) cancels the job and its distribution: 409 ineligible', async () => {
    const { id, item } = await job('tiktok');
    await db.query("UPDATE items SET audience = 'kids' WHERE id = $1", [item]);
    const r = await briefRequest(post(keys.promoter, { id, version: 1, ...goodBrief }), deps());
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'ineligible' });
    expect(await jobRow(id)).toMatchObject({ state: 'cancelled', dstatus: 'cancelled' });
  });

  it('an unknown job is 404; text copy cannot be sent to a video job’s distribution', async () => {
    expect((await briefRequest(post(keys.promoter, { id: 999999, version: 1, ...goodBrief }), deps())).status).toBe(404);
    const { id } = await job('tiktok');
    const did = Number((await db.query<{ distribution_id: string }>('SELECT distribution_id FROM video_jobs WHERE id = $1', [id])).rows[0].distribution_id);
    const r = await copyRequest(post(keys.promoter, { id: did, version: 1, caption: 'Hello', hashtags: [] }, 'copy'), deps());
    expect(r.status).toBe(404);
    expect(await jobRow(id)).toMatchObject({ dstatus: 'selected' });
  });
});

describe('role separation', () => {
  it('only a promoter key sends a brief; every other role 403, no key 401; flag off 404', async () => {
    const { id } = await job('tiktok');
    for (const k of ['content', 'world', 'moderation', 'reviewer']) {
      const r = await briefRequest(post(keys[k], { id, version: 1, ...goodBrief }), deps());
      expect(r.status, k).toBe(403);
    }
    expect((await briefRequest(post('', { id, version: 1, ...goodBrief }), deps())).status).toBe(401);
    vi.stubEnv('SOCIAL_ENABLED', '');
    expect((await briefRequest(post(keys.promoter, { id, version: 1, ...goodBrief }), deps())).status).toBe(404);
    expect(await jobRow(id)).toMatchObject({ state: 'brief_pending' });
  });
});
