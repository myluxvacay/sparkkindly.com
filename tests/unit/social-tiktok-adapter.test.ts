// @vitest-environment node
// The TikTok adapter (plan 5B Task 3) with an injected fetch and a temp token file: token refresh through the store,
// the exact init + chunked upload + status poll requests (Content Posting API, FILE_UPLOAD, SELF_ONLY until the app is
// approved), bounded waits, failure kinds (rate limits transient with a longer backoff; a failure on or after the last
// chunk ambiguous, never retried), credentials refused before any call, and no token in any URL or error.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SocialPostError } from '@/lib/social/adapters/meta';
import { hasTiktokCredentials, tiktok, TIKTOK_CHUNK_BYTES } from '@/lib/social/adapters/tiktok';

const API = 'https://open.tiktokapis.com/v2';
const UPLOAD = 'https://open-upload.tiktokapis.com/video/?upload_id=U1&upload_token=SIGNED';
const NOW = new Date('2026-11-05T12:00:00Z');
let dir: string;
let video: string;
let env: Record<string, string>;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sk-tiktok-'));
  video = path.join(dir, 'v.mp4');
  writeFileSync(video, Buffer.alloc(100, 1));
  const tokens = path.join(dir, 'tokens.json');
  writeFileSync(tokens, JSON.stringify({ tiktok: { accessToken: 'ACT-SECRET', refreshToken: 'RT-SECRET', expiresAt: NOW.getTime() + 3_600_000 } }));
  env = { TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'CS-SECRET', SOCIAL_TOKEN_FILE: tokens };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (data: unknown) => json(200, { data, error: { code: 'ok', message: '' } });
type Call = { url: string; init: RequestInit };
function fakeFetch(answers: (Response | Error)[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const a = answers.shift();
    if (!a) throw new Error('unexpected call');
    if (a instanceof Error) throw a;
    return a;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}
const deps = (f: { fetch: typeof fetch }) => ({ fetch: f.fetch, env, sleep: async () => undefined, now: () => NOW });
const payload = () => ({ filePath: video, size: 100, caption: 'Which shape is odd?', hashtags: ['puzzle'], captionsPath: null });
const reqBody = (c: Call) => JSON.parse(String(c.init.body));
async function failure(p: Promise<unknown>): Promise<SocialPostError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SocialPostError);
    return e as SocialPostError;
  }
  throw new Error('expected a failure');
}
const SECRETS = /ACT-SECRET|RT-SECRET|CS-SECRET|SIGNED/;

describe('TikTok post', () => {
  it('init with SELF_ONLY and the file size, uploads the file, polls until complete', async () => {
    const f = fakeFetch([
      ok({ publish_id: 'v_pub_1', upload_url: UPLOAD }),
      new Response(null, { status: 201 }),
      ok({ status: 'PROCESSING_UPLOAD' }),
      ok({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [] }),
    ]);
    expect(await tiktok.post(payload(), deps(f))).toEqual({ externalId: 'v_pub_1', url: null });
    expect(f.calls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', `${API}/post/publish/video/init/`],
      ['PUT', UPLOAD],
      ['POST', `${API}/post/publish/status/fetch/`],
      ['POST', `${API}/post/publish/status/fetch/`],
    ]);
    expect(reqBody(f.calls[0])).toEqual({
      post_info: { title: 'Which shape is odd?\n\n#puzzle', privacy_level: 'SELF_ONLY' },
      source_info: { source: 'FILE_UPLOAD', video_size: 100, chunk_size: 100, total_chunk_count: 1 },
    });
    const put = new Headers(f.calls[1].init.headers);
    expect(put.get('content-range')).toBe('bytes 0-99/100');
    expect(put.get('content-type')).toBe('video/mp4');
    expect(put.get('authorization')).toBeNull(); // the upload URL is pre-signed; the token stays off it
    expect(reqBody(f.calls[2])).toEqual({ publish_id: 'v_pub_1' });
    for (const c of f.calls) {
      expect(c.init.signal).toBeInstanceOf(AbortSignal);
      expect(c.init.redirect).toBe('manual');
      if (c.url.startsWith(API)) expect(new Headers(c.init.headers).get('authorization')).toBe('Bearer ACT-SECRET');
      expect(c.url).not.toMatch(/ACT-SECRET/);
    }
  });

  it('a public post id, when TikTok gives one, becomes the external id', async () => {
    const f = fakeFetch([ok({ publish_id: 'v_pub_1', upload_url: UPLOAD }), new Response(null, { status: 201 }), ok({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7311] })]);
    expect(await tiktok.post(payload(), deps(f))).toEqual({ externalId: '7311', url: null });
  });

  it('splits a large file into chunks of the fixed size, the last one taking the remainder', async () => {
    const size = TIKTOK_CHUNK_BYTES * 2 + 5;
    writeFileSync(video, Buffer.alloc(size, 2));
    const f = fakeFetch([ok({ publish_id: 'p', upload_url: UPLOAD }), new Response(null, { status: 206 }), new Response(null, { status: 201 }), ok({ status: 'PUBLISH_COMPLETE' })]);
    await tiktok.post({ ...payload(), size }, deps(f));
    expect(reqBody(f.calls[0]).source_info).toEqual({ source: 'FILE_UPLOAD', video_size: size, chunk_size: TIKTOK_CHUNK_BYTES, total_chunk_count: 2 });
    expect(new Headers(f.calls[1].init.headers).get('content-range')).toBe(`bytes 0-${TIKTOK_CHUNK_BYTES - 1}/${size}`);
    expect(new Headers(f.calls[2].init.headers).get('content-range')).toBe(`bytes ${TIKTOK_CHUNK_BYTES}-${size - 1}/${size}`);
  });

  it.each([
    ['429 on init', [json(429, { error: { code: 'rate_limit_exceeded' } })], 'transient', true],
    ['a rate-limit code on init', [json(200, { error: { code: 'rate_limit_exceeded' } })], 'transient', true],
    ['500 on init', [json(500, {})], 'transient', false],
    ['a timeout on init', [new DOMException('t', 'TimeoutError')], 'transient', false],
    ['400 on init', [json(400, { error: { code: 'invalid_params', message: 'bad ACT-SECRET' } })], 'permanent', false],
    ['an upload URL on another host', [ok({ publish_id: 'p', upload_url: 'https://evil.example/u' })], 'permanent', false],
    ['500 on the last chunk', [ok({ publish_id: 'p', upload_url: UPLOAD }), json(500, {})], 'ambiguous', false],
    ['a network error on the last chunk', [ok({ publish_id: 'p', upload_url: UPLOAD }), new TypeError('fetch failed')], 'ambiguous', false],
    ['FAILED after the upload', [ok({ publish_id: 'p', upload_url: UPLOAD }), new Response(null, { status: 201 }), ok({ status: 'FAILED', fail_reason: 'file_format_check_failed' })], 'permanent', false],
    ['a status error after the upload', [ok({ publish_id: 'p', upload_url: UPLOAD }), new Response(null, { status: 201 }), json(500, {})], 'ambiguous', false],
  ] as const)('%s is %s, and no error carries a token or the signed URL', async (_, answers, kind, backoff) => {
    const e = await failure(tiktok.post(payload(), deps(fakeFetch([...answers]))));
    expect(e.kind).toBe(kind);
    expect(!!e.backoffMs).toBe(backoff);
    expect(e.message).not.toMatch(SECRETS);
  });

  it.each([
    ['429', json(429, { error: { code: 'rate_limit_exceeded' } })],
    ['200 with rate_limit_exceeded', json(200, { error: { code: 'rate_limit_exceeded' } })],
    ['401', json(401, { error: { code: 'access_token_invalid' } })],
    ['200 without the envelope', json(200, {})],
    ['200 not JSON', new Response('oops', { status: 200 })],
  ] as const)('5B review H1: after the upload, a status poll answering %s is ambiguous, never transient', async (_, poll) => {
    const f = fakeFetch([ok({ publish_id: 'v_pub_1', upload_url: UPLOAD }), new Response(null, { status: 201 }), poll]);
    const e = await failure(tiktok.post(payload(), deps(f)));
    expect(e.kind).toBe('ambiguous');
    expect(e.backoffMs).toBeUndefined();
  });

  it('5B review H1: the publish id is handed to the poster before the upload and the polling', async () => {
    const seen: string[] = [];
    const f = fakeFetch([ok({ publish_id: 'v_pub_7', upload_url: UPLOAD }), new Response(null, { status: 201 }), json(500, {})]);
    await failure(tiktok.post(payload(), { ...deps(f), onPublishId: async (id: string) => { seen.push(`${id}@${f.calls.length}`); } }));
    expect(seen).toEqual(['v_pub_7@1']);
  });

  it('5B review H1: check() settles a publish id: complete, failed, or still pending (errors are pending)', async () => {
    const c = (answer: Response | Error) => tiktok.check!({ externalId: 'v_pub_1' }, deps(fakeFetch([answer])));
    expect(await c(ok({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [42] }))).toEqual({ state: 'posted', externalId: '42', url: null });
    expect(await c(ok({ status: 'PUBLISH_COMPLETE' }))).toEqual({ state: 'posted', externalId: 'v_pub_1', url: null });
    expect(await c(ok({ status: 'FAILED' }))).toEqual({ state: 'failed' });
    expect(await c(ok({ status: 'PROCESSING_UPLOAD' }))).toEqual({ state: 'pending' });
    expect(await c(json(429, {}))).toEqual({ state: 'pending' });
    expect(await c(new TypeError('fetch failed'))).toEqual({ state: 'pending' });
  });

  it('a status poll that never completes within the bounded wait is ambiguous (it may still publish)', async () => {
    const f = fakeFetch([ok({ publish_id: 'p', upload_url: UPLOAD }), new Response(null, { status: 201 }), ...Array.from({ length: 30 }, () => ok({ status: 'PROCESSING_UPLOAD' }))]);
    expect((await failure(tiktok.post(payload(), deps(f)))).kind).toBe('ambiguous');
    expect(f.calls.length).toBeLessThanOrEqual(15);
  });

  it('an expired access token is refreshed with the client key and the stored refresh token first', async () => {
    writeFileSync(env.SOCIAL_TOKEN_FILE, JSON.stringify({ tiktok: { accessToken: 'OLD', refreshToken: 'RT-SECRET', expiresAt: 0 } }));
    const f = fakeFetch([
      json(200, { access_token: 'ACT-SECRET', refresh_token: 'RT2', expires_in: 86400 }),
      ok({ publish_id: 'p', upload_url: UPLOAD }),
      new Response(null, { status: 201 }),
      ok({ status: 'PUBLISH_COMPLETE' }),
    ]);
    await tiktok.post(payload(), deps(f));
    expect([f.calls[0].init.method, f.calls[0].url]).toEqual(['POST', `${API}/oauth/token/`]);
    expect(Object.fromEntries(new URLSearchParams(String(f.calls[0].init.body)))).toEqual({
      client_key: 'ck', client_secret: 'CS-SECRET', grant_type: 'refresh_token', refresh_token: 'RT-SECRET',
    });
  });

  it('missing credentials are refused before any request; privacy follows TIKTOK_PRIVACY only for allowed values', async () => {
    const f = fakeFetch([]);
    expect(hasTiktokCredentials({ SOCIAL_TOKEN_FILE: env.SOCIAL_TOKEN_FILE })).toBe(false);
    expect((await failure(tiktok.post(payload(), { ...deps(f), env: { SOCIAL_TOKEN_FILE: env.SOCIAL_TOKEN_FILE } }))).kind).toBe('credentials');
    expect(f.calls).toEqual([]);
    expect(hasTiktokCredentials(env)).toBe(true);
    const g = fakeFetch([ok({ publish_id: 'p', upload_url: UPLOAD }), new Response(null, { status: 201 }), ok({ status: 'PUBLISH_COMPLETE' })]);
    await tiktok.post(payload(), { ...deps(g), env: { ...env, TIKTOK_PRIVACY: 'EVERYONE; DROP' } });
    expect(reqBody(g.calls[0]).post_info.privacy_level).toBe('SELF_ONLY');
  });
});

describe('TikTok metrics', () => {
  it('reads views, likes and comments for a public post id; nothing for a private publish id', async () => {
    const f = fakeFetch([ok({ videos: [{ id: '7311', view_count: 50, like_count: 4, comment_count: 1 }] })]);
    expect(await tiktok.metrics({ externalId: '7311' }, deps(f))).toEqual({ views: 50, likes: 4, comments: 1 });
    expect(f.calls[0].url).toBe(`${API}/video/query/?fields=id,view_count,like_count,comment_count`);
    const none = fakeFetch([]);
    expect(await tiktok.metrics({ externalId: 'v_pub_1' }, deps(none))).toEqual({});
  });
});
