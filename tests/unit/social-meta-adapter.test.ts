// @vitest-environment node
// The Meta Graph adapter (plan 5A Task 3) with an injected fetch: the exact Instagram (container, bounded status poll,
// publish, permalink) and Facebook (Page photo) requests; the token only in the Authorization header, never in a URL or
// an error message; every call bounded by a timeout signal; missing credentials refused before any call; transient,
// permanent and ambiguous failures told apart (a failed final publish call may have posted, so it is never retried).
import { describe, it, expect, vi } from 'vitest';
import { facebook, hasCredentials, instagram, SocialPostError } from '@/lib/social/adapters/meta';

const TOKEN = 'EAAtesttoken-SECRET-123';
const env = { META_PAGE_ACCESS_TOKEN: TOKEN, META_PAGE_ID: '111', META_IG_USER_ID: '222' };
const G = 'https://graph.facebook.com/v21.0';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = { url: string; init: RequestInit };

function fakeFetch(answers: (Response | Error | ((c: Call) => Response))[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const a = answers.shift();
    if (!a) throw new Error('unexpected call');
    if (a instanceof Error) throw a;
    return typeof a === 'function' ? a(call) : a;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}
const body = (c: Call) => Object.fromEntries(new URLSearchParams(String(c.init.body)));
const deps = (f: { fetch: typeof fetch }) => ({ fetch: f.fetch, env, sleep: async () => undefined });
const post = { text: 'Spot it!\n\n#puzzle', imageUrl: 'https://sparkkindly.com/api/template-image/play/x/?format=social' };

async function failure(p: Promise<unknown>): Promise<SocialPostError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SocialPostError);
    return e as SocialPostError;
  }
  throw new Error('expected a failure');
}

function assertSafe(calls: Call[]) {
  for (const c of calls) {
    expect(c.url).not.toContain(TOKEN);
    expect(c.url).not.toContain('access_token');
    expect(new Headers(c.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(c.init.signal).toBeInstanceOf(AbortSignal);
    expect(c.init.redirect).toBe('manual');
  }
}

describe('Instagram', () => {
  it('creates a container with the stored caption and image, polls until finished, publishes, reads the permalink', async () => {
    const f = fakeFetch([
      json(200, { id: 'C1' }),
      json(200, { status_code: 'IN_PROGRESS' }),
      json(200, { status_code: 'FINISHED' }),
      json(200, { id: 'M1' }),
      json(200, { permalink: 'https://www.instagram.com/p/abc/' }),
    ]);
    expect(await instagram.post(post, deps(f))).toEqual({ externalId: 'M1', url: 'https://www.instagram.com/p/abc/' });
    expect(f.calls.map((c) => [c.init.method ?? 'GET', c.url])).toEqual([
      ['POST', `${G}/222/media`],
      ['GET', `${G}/C1?fields=status_code`],
      ['GET', `${G}/C1?fields=status_code`],
      ['POST', `${G}/222/media_publish`],
      ['GET', `${G}/M1?fields=permalink`],
    ]);
    expect(body(f.calls[0])).toEqual({ image_url: post.imageUrl, caption: post.text });
    expect(body(f.calls[3])).toEqual({ creation_id: 'C1' });
    assertSafe(f.calls);
  });

  it('a container that never finishes within the bounded wait is transient; ERROR is permanent; nothing is published', async () => {
    const slow = fakeFetch([json(200, { id: 'C1' }), ...Array.from({ length: 10 }, () => json(200, { status_code: 'IN_PROGRESS' }))]);
    expect((await failure(instagram.post(post, deps(slow)))).kind).toBe('transient');
    expect(slow.calls.some((c) => c.url.endsWith('media_publish'))).toBe(false);
    expect(slow.calls.length).toBeLessThanOrEqual(7);
    const broken = fakeFetch([json(200, { id: 'C1' }), json(200, { status_code: 'ERROR' })]);
    expect((await failure(instagram.post(post, deps(broken)))).kind).toBe('permanent');
  });

  it('a permalink failure after publishing still counts as posted', async () => {
    const f = fakeFetch([json(200, { id: 'C1' }), json(200, { status_code: 'FINISHED' }), json(200, { id: 'M1' }), json(500, {})]);
    expect(await instagram.post(post, deps(f))).toEqual({ externalId: 'M1', url: null });
  });

  it.each([
    ['429 on the container', [json(429, {})], 'transient'],
    ['500 on the container', [json(500, {})], 'transient'],
    ['a network error on the container', [new TypeError('fetch failed')], 'transient'],
    ['a timeout on the container', [new DOMException('timed out', 'TimeoutError')], 'transient'],
    ['400 on the container', [json(400, { error: { code: 100, message: `bad ${TOKEN}` } })], 'permanent'],
    ['an expired token', [json(401, { error: { code: 190, message: 'expired' } })], 'permanent'],
    ['429 on publish', [json(200, { id: 'C1' }), json(200, { status_code: 'FINISHED' }), json(429, {})], 'transient'],
    ['500 on publish (may have posted)', [json(200, { id: 'C1' }), json(200, { status_code: 'FINISHED' }), json(500, {})], 'ambiguous'],
    ['a timeout on publish (may have posted)', [json(200, { id: 'C1' }), json(200, { status_code: 'FINISHED' }), new DOMException('t', 'TimeoutError')], 'ambiguous'],
    ['a redirect', [new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })], 'permanent'],
    // 5A review H1: a 200 from the publish call that cannot be read may still have posted.
    ['a 200 non-JSON publish answer', [json(200, { id: 'C1' }), json(200, { status_code: 'FINISHED' }), new Response('oops', { status: 200 })], 'ambiguous'],
    ['a 200 publish answer without an id', [json(200, { id: 'C1' }), json(200, { status_code: 'FINISHED' }), json(200, {})], 'ambiguous'],
  ] as const)('%s is %s, and the error never carries the token', async (_, answers, kind) => {
    const f = fakeFetch([...answers]);
    const e = await failure(instagram.post(post, deps(f)));
    expect(e.kind).toBe(kind);
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).not.toContain(post.text);
  });

  it('an expired token says so', async () => {
    const f = fakeFetch([json(401, { error: { code: 190 } })]);
    expect((await failure(instagram.post(post, deps(f)))).message).toMatch(/token/i);
  });

  it('missing credentials are refused before any request', async () => {
    const f = fakeFetch([]);
    for (const e of [{}, { META_PAGE_ACCESS_TOKEN: TOKEN }, { META_IG_USER_ID: '222' }]) {
      expect((await failure(instagram.post(post, { fetch: f.fetch, env: e }))).kind).toBe('credentials');
    }
    expect(f.calls).toEqual([]);
    expect(hasCredentials('instagram', env)).toBe(true);
    expect(hasCredentials('instagram', { META_PAGE_ACCESS_TOKEN: TOKEN, META_PAGE_ID: '1' })).toBe(false);
    expect(hasCredentials('facebook', { META_PAGE_ACCESS_TOKEN: TOKEN, META_PAGE_ID: '1' })).toBe(true);
    expect(hasCredentials('tiktok', env)).toBe(false);
  });

  it('metrics: reach from insights, likes and comments from the media fields; an insights failure is tolerated', async () => {
    const f = fakeFetch([json(200, { like_count: 4, comments_count: 2 }), json(200, { data: [{ name: 'reach', values: [{ value: 120 }] }] })]);
    expect(await instagram.metrics({ externalId: 'M1' }, deps(f))).toEqual({ likes: 4, comments: 2, reach: 120 });
    expect(f.calls.map((c) => c.url)).toEqual([`${G}/M1?fields=like_count,comments_count`, `${G}/M1/insights?metric=reach`]);
    assertSafe(f.calls);
    const g = fakeFetch([json(200, { like_count: 1, comments_count: 0 }), json(400, {})]);
    expect(await instagram.metrics({ externalId: 'M1' }, deps(g))).toEqual({ likes: 1, comments: 0 });
  });
});

describe('Facebook', () => {
  it('posts one Page photo with the stored text (caption and link) and the image URL', async () => {
    const f = fakeFetch([json(200, { id: 'P9', post_id: '111_999' })]);
    const text = 'Spot it!\n\nhttps://sparkkindly.com/play/x/?utm_source=facebook\n\n#puzzle';
    expect(await facebook.post({ ...post, text }, deps(f))).toEqual({ externalId: '111_999', url: 'https://www.facebook.com/111_999' });
    expect(f.calls.map((c) => [c.init.method, c.url])).toEqual([['POST', `${G}/111/photos`]]);
    expect(body(f.calls[0])).toEqual({ url: post.imageUrl, message: text });
    assertSafe(f.calls);
  });

  it('a 200 from the publish call without a usable post id, or not JSON, may have posted: ambiguous (5A review H1)', async () => {
    for (const a of [json(200, { id: 'P9' }), new Response('<html>ok</html>', { status: 200 }), json(200, { post_id: '../x' })]) {
      expect((await failure(facebook.post(post, deps(fakeFetch([a]))))).kind).toBe('ambiguous');
    }
  });

  it('its single call is the publish: 5xx or a timeout may have posted (ambiguous); 429 transient; 400 permanent', async () => {
    for (const [a, kind] of [[json(503, {}), 'ambiguous'], [new TypeError('fetch failed'), 'ambiguous'], [json(429, {}), 'transient'], [json(400, {}), 'permanent']] as const) {
      expect((await failure(facebook.post(post, deps(fakeFetch([a]))))).kind).toBe(kind);
    }
  });

  it('missing credentials are refused before any request', async () => {
    const f = fakeFetch([]);
    expect((await failure(facebook.post(post, { fetch: f.fetch, env: { META_PAGE_ID: '111' } }))).kind).toBe('credentials');
    expect(f.calls).toEqual([]);
  });

  it('metrics: reactions and comments totals, reach from insights', async () => {
    const f = fakeFetch([
      json(200, { reactions: { summary: { total_count: 7 } }, comments: { summary: { total_count: 3 } } }),
      json(200, { data: [{ name: 'post_impressions_unique', values: [{ value: 300 }] }] }),
    ]);
    expect(await facebook.metrics({ externalId: '111_999' }, deps(f))).toEqual({ likes: 7, comments: 3, reach: 300 });
    expect(f.calls.map((c) => c.url)).toEqual([
      `${G}/111_999?fields=reactions.summary(total_count),comments.summary(total_count)`,
      `${G}/111_999/insights?metric=post_impressions_unique`,
    ]);
  });
});
