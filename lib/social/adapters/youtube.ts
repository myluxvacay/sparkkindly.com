// The YouTube adapter (plan 5B): Data API v3 resumable upload (videos.insert) for Shorts. The session is started with
// the server's metadata only: the brief's title, description with hashtags, category 27 (Education), privacy from
// YOUTUBE_PRIVACY (public or unlisted; anything else private, the default) and selfDeclaredMadeForKids false (Kids items
// never get here). The file goes up in 8 MB chunks (308 between them); the last chunk publishes, so a failure on it is
// ambiguous and never retried. Then the caption file goes up with captions.insert; if that fails the video exists, so
// the result carries a warning (the poster flags it) instead of failing. Quota errors are transient with a 6 hour
// backoff. Credentials: YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET from the env at call time; tokens from the token
// store. The session URL never appears in an error. No Next.js imports. Verified by tests/unit/social-youtube-adapter.test.ts.
import { readFile } from 'node:fs/promises';
import type { EnvLike } from '@/lib/env';
import { accessToken, tokenStatus } from '../token-store';
import { SocialPostError } from './meta';
import { clean, json, num, readChunk, send, withTags, type VideoAdapter, type VideoDeps, type VideoPayload } from './video';

const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';
const SERVICE = 'YouTube';
export const YOUTUBE_CHUNK_BYTES = 32 * 256 * 1024; // 8 MB, a multiple of 256 KB as the API requires
const CATEGORY_EDUCATION = '27';

const keys = (env: EnvLike) => ({ id: (env.YOUTUBE_CLIENT_ID ?? '').trim(), secret: (env.YOUTUBE_CLIENT_SECRET ?? '').trim() });
export const hasYoutubeCredentials = (env: EnvLike): boolean => {
  const k = keys(env);
  return !!k.id && !!k.secret && tokenStatus('youtube', env) === 'ok';
};

async function token(deps: VideoDeps): Promise<string> {
  const k = keys(deps.env);
  if (!hasYoutubeCredentials(deps.env)) throw new SocialPostError('credentials', 'no credentials');
  return accessToken('youtube', {
    env: deps.env,
    now: deps.now?.() ?? new Date(),
    refresh: async (refreshToken) => {
      const res = await send(deps, {
        service: SERVICE,
        url: 'https://oauth2.googleapis.com/token',
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: k.id, client_secret: k.secret, grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
      });
      const j = await json<{ access_token?: unknown; expires_in?: unknown }>(res, SERVICE);
      if (typeof j.access_token !== 'string') throw new SocialPostError('credentials', 'Google refused the refresh token');
      return { accessToken: j.access_token, expiresIn: num(j.expires_in) ?? 0 };
    },
  });
}

const privacy = (env: EnvLike) => (env.YOUTUBE_PRIVACY === 'public' || env.YOUTUBE_PRIVACY === 'unlisted' ? env.YOUTUBE_PRIVACY : 'private');

function sessionUrl(v: string | null): string {
  try {
    const u = new URL(v ?? '');
    if (u.protocol === 'https:' && u.hostname === 'www.googleapis.com') return u.toString();
  } catch {
    // fall through
  }
  throw new SocialPostError('permanent', 'YouTube returned an unusable upload session');
}

async function startSession(deps: VideoDeps, t: string, d: VideoPayload): Promise<string> {
  const res = await send(deps, {
    service: SERVICE,
    url: `${UPLOAD}/videos?uploadType=resumable&part=snippet,status`,
    method: 'POST',
    headers: {
      authorization: `Bearer ${t}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(d.size),
      'x-upload-content-type': 'video/mp4',
    },
    body: JSON.stringify({
      snippet: { title: d.title ?? d.caption, description: withTags(d.description ?? '', d.hashtags), categoryId: CATEGORY_EDUCATION },
      status: { privacyStatus: privacy(deps.env), selfDeclaredMadeForKids: false },
    }),
  });
  return sessionUrl(res.headers.get('location'));
}

async function upload(deps: VideoDeps, t: string, url: string, d: VideoPayload): Promise<string> {
  for (let start = 0; ; start += YOUTUBE_CHUNK_BYTES) {
    const end = Math.min(start + YOUTUBE_CHUNK_BYTES, d.size);
    const final = end === d.size;
    const res = await send(deps, {
      service: SERVICE,
      url,
      method: 'PUT',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'video/mp4', 'content-range': `bytes ${start}-${end - 1}/${d.size}` },
      body: await readChunk(d.filePath, start, end - start),
      final,
      accept: final ? [] : [308],
      chunk: true,
    });
    if (!final) continue;
    const id = (await json<{ id?: unknown }>(res, SERVICE, true)).id;
    if (typeof id !== 'string' || !/^[\w-]{1,20}$/.test(id)) throw new SocialPostError('ambiguous', 'YouTube returned no usable video id');
    return id;
  }
}

async function insertCaptions(deps: VideoDeps, t: string, videoId: string, captionsPath: string): Promise<void> {
  const boundary = `sk${Date.now().toString(36)}`;
  const meta = JSON.stringify({ snippet: { videoId, language: 'en', name: 'English' } });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    await readFile(captionsPath),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  await send(deps, {
    service: SERVICE,
    url: `${UPLOAD}/captions?uploadType=multipart&part=snippet`,
    method: 'POST',
    headers: { authorization: `Bearer ${t}`, 'content-type': `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
}

export const youtube: VideoAdapter = {
  async post(d, deps) {
    const t = await token(deps);
    const id = await upload(deps, t, await startSession(deps, t, d), d);
    const result = { externalId: id, url: `https://www.youtube.com/shorts/${id}` };
    if (!d.captionsPath) return result;
    try {
      await insertCaptions(deps, t, id, d.captionsPath);
      return result;
    } catch {
      return { ...result, warning: 'posted without captions: add the caption file in YouTube Studio' };
    }
  },

  async metrics(d, deps) {
    if (!/^[\w-]{1,20}$/.test(d.externalId)) return {};
    const t = await token(deps);
    const res = await send(deps, {
      service: SERVICE,
      url: `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${d.externalId}`,
      method: 'GET',
      headers: { authorization: `Bearer ${t}` },
    });
    const s = (await json<{ items?: { statistics?: Record<string, unknown> }[] }>(res, SERVICE)).items?.[0]?.statistics ?? {};
    return clean({ views: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount) });
  },
};
