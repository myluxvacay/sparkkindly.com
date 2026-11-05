// @vitest-environment node
// The YouTube adapter (plan 5B Task 3) with an injected fetch and a temp token file: token refresh (Google), the
// resumable upload session (videos.insert with selfDeclaredMadeForKids false, the server's category, privacy from
// YOUTUBE_PRIVACY defaulting to private), the chunked upload, captions.insert, quota errors (transient with a long
// backoff), a failure on the last chunk ambiguous, a captions failure after posting a warning (never a retry), and no
// token or session URL in any error.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SocialPostError } from '@/lib/social/adapters/meta';
import { hasYoutubeCredentials, youtube, YOUTUBE_CHUNK_BYTES } from '@/lib/social/adapters/youtube';

const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';
const SESSION = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=SESSION-SECRET';
const NOW = new Date('2026-11-05T12:00:00Z');
let dir: string;
let video: string;
let captions: string;
let env: Record<string, string>;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sk-youtube-'));
  video = path.join(dir, 'v.mp4');
  captions = path.join(dir, 'c.vtt');
  writeFileSync(video, Buffer.alloc(100, 1));
  writeFileSync(captions, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n');
  const tokens = path.join(dir, 'tokens.json');
  writeFileSync(tokens, JSON.stringify({ youtube: { accessToken: 'ACT-SECRET', refreshToken: 'RT-SECRET', expiresAt: NOW.getTime() + 3_600_000 } }));
  env = { YOUTUBE_CLIENT_ID: 'cid', YOUTUBE_CLIENT_SECRET: 'CS-SECRET', SOCIAL_TOKEN_FILE: tokens };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const session = () => new Response(null, { status: 200, headers: { location: SESSION } });
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
const deps = (f: { fetch: typeof fetch }, e = env) => ({ fetch: f.fetch, env: e, sleep: async () => undefined, now: () => NOW });
const payload = (o = {}) => ({
  filePath: video, size: 100, caption: 'Spot the odd shape', hashtags: ['puzzle'], title: 'Spot the odd shape',
  description: 'A ten second puzzle.', captionsPath: captions, ...o,
});
async function failure(p: Promise<unknown>): Promise<SocialPostError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SocialPostError);
    return e as SocialPostError;
  }
  throw new Error('expected a failure');
}
const SECRETS = /ACT-SECRET|RT-SECRET|CS-SECRET|SESSION-SECRET/;

describe('YouTube post', () => {
  it('starts a resumable session with the server metadata, uploads, then inserts the captions', async () => {
    const f = fakeFetch([session(), json(200, { id: 'yt123' }), json(200, { id: 'cap1' })]);
    expect(await youtube.post(payload(), deps(f))).toEqual({ externalId: 'yt123', url: 'https://www.youtube.com/shorts/yt123' });
    expect(f.calls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', `${UPLOAD}/videos?uploadType=resumable&part=snippet,status`],
      ['PUT', SESSION],
      ['POST', `${UPLOAD}/captions?uploadType=multipart&part=snippet`],
    ]);
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
      snippet: { title: 'Spot the odd shape', description: 'A ten second puzzle.\n\n#puzzle', categoryId: '27' },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
    });
    const start = new Headers(f.calls[0].init.headers);
    expect(start.get('x-upload-content-length')).toBe('100');
    expect(start.get('x-upload-content-type')).toBe('video/mp4');
    expect(new Headers(f.calls[1].init.headers).get('content-range')).toBe('bytes 0-99/100');
    const multipart = Buffer.from(f.calls[2].init.body as Uint8Array).toString();
    expect(multipart).toContain('"videoId":"yt123"');
    expect(multipart).toContain('WEBVTT');
    for (const c of f.calls) {
      expect(new Headers(c.init.headers).get('authorization')).toBe('Bearer ACT-SECRET');
      expect(c.init.signal).toBeInstanceOf(AbortSignal);
      expect(c.init.redirect).toBe('manual');
      expect(c.url).not.toMatch(/ACT-SECRET/);
    }
  });

  it('privacy follows YOUTUBE_PRIVACY (public, unlisted), anything else private', async () => {
    for (const [value, expected] of [['public', 'public'], ['unlisted', 'unlisted'], ['PUBLIC!', 'private']]) {
      const f = fakeFetch([session(), json(200, { id: 'y' }), json(200, { id: 'c' })]);
      await youtube.post(payload(), deps(f, { ...env, YOUTUBE_PRIVACY: value }));
      expect(JSON.parse(String(f.calls[0].init.body)).status.privacyStatus).toBe(expected);
    }
  });

  it('uploads a large file in chunks (308 between them)', async () => {
    const size = YOUTUBE_CHUNK_BYTES + 10;
    writeFileSync(video, Buffer.alloc(size, 3));
    const f = fakeFetch([session(), new Response(null, { status: 308 }), json(201, { id: 'y' })]);
    await youtube.post(payload({ size, captionsPath: null }), deps(f));
    expect(new Headers(f.calls[1].init.headers).get('content-range')).toBe(`bytes 0-${YOUTUBE_CHUNK_BYTES - 1}/${size}`);
    expect(new Headers(f.calls[2].init.headers).get('content-range')).toBe(`bytes ${YOUTUBE_CHUNK_BYTES}-${size - 1}/${size}`);
  });

  it('a captions failure after the video exists is a warning, never a failure (the post exists)', async () => {
    const f = fakeFetch([session(), json(200, { id: 'yt9' }), json(500, {})]);
    expect(await youtube.post(payload(), deps(f))).toEqual({
      externalId: 'yt9',
      url: 'https://www.youtube.com/shorts/yt9',
      warning: expect.stringMatching(/captions/i),
    });
  });

  it.each([
    ['quotaExceeded on the session', [json(403, { error: { errors: [{ reason: 'quotaExceeded' }] } })], 'transient', true],
    ['429 on the session', [json(429, {})], 'transient', true],
    ['500 on the session', [json(500, {})], 'transient', false],
    ['a session URL on another host', [new Response(null, { status: 200, headers: { location: 'https://evil.example/x' } })], 'permanent', false],
    ['400 on the session', [json(400, { error: { errors: [{ reason: 'invalidTitle' }] } })], 'permanent', false],
    ['500 on the last chunk', [session(), json(500, {})], 'ambiguous', false],
    ['a timeout on the last chunk', [session(), new DOMException('t', 'TimeoutError')], 'ambiguous', false],
    ['a 200 without an id on the last chunk', [session(), new Response('oops', { status: 200 })], 'ambiguous', false],
  ] as const)('%s is %s, and no error carries a token or the session URL', async (_, answers, kind, backoff) => {
    const e = await failure(youtube.post(payload(), deps(fakeFetch([...answers]))));
    expect(e.kind).toBe(kind);
    expect(!!e.backoffMs).toBe(backoff);
    expect(e.message).not.toMatch(SECRETS);
  });

  it('refreshes an expired token with Google; invalid_grant marks re-authorisation', async () => {
    writeFileSync(env.SOCIAL_TOKEN_FILE, JSON.stringify({ youtube: { accessToken: 'OLD', refreshToken: 'RT-SECRET', expiresAt: 0 } }));
    const f = fakeFetch([json(400, { error: 'invalid_grant' })]);
    const e = await failure(youtube.post(payload(), deps(f)));
    expect(e.kind).toBe('credentials');
    expect(f.calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(new URLSearchParams(String(f.calls[0].init.body)))).toEqual({
      client_id: 'cid', client_secret: 'CS-SECRET', grant_type: 'refresh_token', refresh_token: 'RT-SECRET',
    });
    expect(hasYoutubeCredentials(env)).toBe(false);
  });

  it('missing credentials are refused before any request', async () => {
    const f = fakeFetch([]);
    expect((await failure(youtube.post(payload(), deps(f, { SOCIAL_TOKEN_FILE: env.SOCIAL_TOKEN_FILE })))).kind).toBe('credentials');
    expect(f.calls).toEqual([]);
  });
});

describe('YouTube metrics', () => {
  it('reads views, likes and comments from statistics', async () => {
    const f = fakeFetch([json(200, { items: [{ statistics: { viewCount: '120', likeCount: '7', commentCount: '2' } }] })]);
    expect(await youtube.metrics({ externalId: 'yt123' }, deps(f))).toEqual({ views: 120, likes: 7, comments: 2 });
    expect(f.calls[0].url).toBe('https://www.googleapis.com/youtube/v3/videos?part=statistics&id=yt123');
  });
});
