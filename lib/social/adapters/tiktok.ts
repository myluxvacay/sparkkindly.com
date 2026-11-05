// The TikTok adapter (plan 5B): the Content Posting API, direct post with FILE_UPLOAD. Init (caption with hashtags,
// privacy, file size and chunk plan), the file PUT to TikTok's pre-signed upload URL in chunks of 10 MB (the last
// chunk takes the remainder; a smaller file goes in one), then a bounded status poll. Posts are SELF_ONLY (private)
// until the owner sets TIKTOK_PRIVACY to another allowed level after TikTok approves the app. Credentials:
// TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET from the env at call time; tokens from the token store (refresh tokens
// rotate). The last chunk publishes: any failure on it or after it (status errors, a wait that runs out) is ambiguous
// and never retried; FAILED from TikTok is permanent (nothing was posted). The upload URL never appears in an error.
// No Next.js imports. Verified by tests/unit/social-tiktok-adapter.test.ts.
import type { EnvLike } from '@/lib/env';
import { accessToken, tokenStatus } from '../token-store';
import { SocialPostError } from './meta';
import { clean, failure, json, num, readChunk, reasonOf, send, withTags, type CheckResult, type VideoAdapter, type VideoDeps, type VideoPayload } from './video';

const API = 'https://open.tiktokapis.com/v2';
const SERVICE = 'TikTok';
export const TIKTOK_CHUNK_BYTES = 10 * 1024 * 1024;
const POLL_TRIES = 10;
const POLL_WAIT_MS = 5_000;
const PRIVACY = new Set(['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE']);

const keys = (env: EnvLike) => ({ key: (env.TIKTOK_CLIENT_KEY ?? '').trim(), secret: (env.TIKTOK_CLIENT_SECRET ?? '').trim() });
export const hasTiktokCredentials = (env: EnvLike): boolean => {
  const k = keys(env);
  return !!k.key && !!k.secret && tokenStatus('tiktok', env) === 'ok';
};

type Envelope<T> = { data?: T; error?: { code?: unknown } };

async function call<T>(deps: VideoDeps, token: string, path: string, body: unknown, final = false): Promise<T> {
  const res = await send(deps, {
    service: SERVICE,
    url: `${API}/${path}`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
    final,
  });
  const j = await json<Envelope<T>>(res, SERVICE, final);
  if (j.error?.code !== 'ok') throw failure(SERVICE, res.status, reasonOf(j), final);
  return (j.data ?? {}) as T;
}

async function token(deps: VideoDeps): Promise<string> {
  const k = keys(deps.env);
  if (!hasTiktokCredentials(deps.env)) throw new SocialPostError('credentials', 'no credentials');
  return accessToken('tiktok', {
    env: deps.env,
    now: deps.now?.() ?? new Date(),
    refresh: async (refreshToken) => {
      const res = await send(deps, {
        service: SERVICE,
        url: `${API}/oauth/token/`,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: k.key, client_secret: k.secret, grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
      });
      const j = await json<{ access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }>(res, SERVICE);
      if (typeof j.access_token !== 'string') throw new SocialPostError('credentials', 'TikTok refused the refresh token');
      return { accessToken: j.access_token, refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : undefined, expiresIn: num(j.expires_in) ?? 0 };
    },
  });
}

const plan = (size: number) => {
  const chunk = size <= TIKTOK_CHUNK_BYTES ? size : TIKTOK_CHUNK_BYTES;
  return { chunk, count: Math.floor(size / chunk) };
};

function uploadUrl(v: unknown): string {
  try {
    const u = new URL(String(v));
    if (u.protocol === 'https:' && u.hostname.endsWith('.tiktokapis.com')) return u.toString();
  } catch {
    // fall through
  }
  throw new SocialPostError('permanent', 'TikTok returned an unusable upload address');
}

async function upload(deps: VideoDeps, url: string, d: VideoPayload, chunk: number, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const start = i * chunk;
    const end = i === count - 1 ? d.size : start + chunk;
    const body = await readChunk(d.filePath, start, end - start);
    await send(deps, {
      service: SERVICE,
      url,
      method: 'PUT',
      headers: { 'content-type': 'video/mp4', 'content-length': String(body.length), 'content-range': `bytes ${start}-${end - 1}/${d.size}` },
      body,
      final: i === count - 1,
      chunk: true,
    });
  }
}

type Status = { status?: string; publicaly_available_post_id?: unknown[] };
const statusOf = (deps: VideoDeps, token: string, publishId: string) =>
  call<Status>(deps, token, 'post/publish/status/fetch/', { publish_id: publishId }, true);
const publicId = (s: Status): string | null => {
  const id = s.publicaly_available_post_id?.[0];
  return (typeof id === 'string' || typeof id === 'number') && /^[0-9]{1,30}$/.test(String(id)) ? String(id) : null;
};

// After the upload everything is ambiguous except an explicit FAILED (call(..., final) makes every error ambiguous).
async function waitForPublish(deps: VideoDeps, token: string, publishId: string): Promise<string | null> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 0; i < POLL_TRIES; i++) {
    const s = await statusOf(deps, token, publishId);
    if (s.status === 'PUBLISH_COMPLETE') return publicId(s);
    if (s.status === 'FAILED') throw new SocialPostError('permanent', 'TikTok could not process the video');
    await sleep(POLL_WAIT_MS);
  }
  throw new SocialPostError('ambiguous', 'TikTok was still processing the video after the bounded wait');
}

export const tiktok: VideoAdapter = {
  async post(d, deps) {
    const t = await token(deps);
    const { chunk, count } = plan(d.size);
    const privacy = PRIVACY.has(deps.env.TIKTOK_PRIVACY ?? '') ? deps.env.TIKTOK_PRIVACY! : 'SELF_ONLY';
    const init = await call<{ publish_id?: unknown; upload_url?: unknown }>(deps, t, 'post/publish/video/init/', {
      post_info: { title: withTags(d.caption, d.hashtags), privacy_level: privacy },
      source_info: { source: 'FILE_UPLOAD', video_size: d.size, chunk_size: chunk, total_chunk_count: count },
    });
    const publishId = typeof init.publish_id === 'string' && /^[\w.-]{1,100}$/.test(init.publish_id) ? init.publish_id : null;
    if (!publishId) throw new SocialPostError('permanent', 'TikTok returned no usable publish id');
    await deps.onPublishId?.(publishId);
    await upload(deps, uploadUrl(init.upload_url), d, chunk, count);
    const postId = await waitForPublish(deps, t, publishId);
    return { externalId: postId ?? publishId, url: null };
  },

  async check(d, deps): Promise<CheckResult> {
    try {
      const s = await statusOf(deps, await token(deps), d.externalId);
      if (s.status === 'PUBLISH_COMPLETE') return { state: 'posted', externalId: publicId(s) ?? d.externalId, url: null };
      return s.status === 'FAILED' ? { state: 'failed' } : { state: 'pending' };
    } catch {
      return { state: 'pending' };
    }
  },

  // Only a public post id can be queried; a private post (publish id) has no metrics.
  async metrics(d, deps) {
    if (!/^\d{1,30}$/.test(d.externalId)) return {};
    const t = await token(deps);
    const r = await call<{ videos?: { view_count?: unknown; like_count?: unknown; comment_count?: unknown }[] }>(
      deps, t, 'video/query/?fields=id,view_count,like_count,comment_count', { filters: { video_ids: [d.externalId] } },
    );
    const v = r.videos?.[0] ?? {};
    return clean({ views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count) });
  },
};
