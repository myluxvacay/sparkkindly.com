// What the TikTok and YouTube adapters share (plan 5B): the video payload (the approved file, read from disk by the
// worker, and the brief's captions), the adapter shape (the 5A PlatformAdapter's post/metrics with a video payload)
// and one bounded HTTP call. Every call has a timeout, follows no redirect and never puts a token in a URL; errors carry
// the service, the HTTP status and a short platform reason code only, never a token, an upload URL or response text.
// Kinds as in 5A: transient (429, 5xx, network) retried later, with a longer backoff for quota and rate limits;
// permanent (other 4xx); ambiguous for the call that publishes (it may have posted), never retried.
// No Next.js imports. Verified by tests/unit/social-tiktok-adapter.test.ts and social-youtube-adapter.test.ts.
import { open } from 'node:fs/promises';
import { SocialPostError, type AdapterDeps, type Metrics } from './meta';

export type VideoPayload = {
  filePath: string;
  size: number;
  caption: string; // TikTok: the caption; YouTube: the title
  hashtags: string[];
  title?: string;
  description?: string;
  captionsPath: string | null;
};
export type VideoDeps = AdapterDeps & { now?: () => Date };
export type VideoResult = { externalId: string; url: string | null; warning?: string };
export interface VideoAdapter {
  post(d: VideoPayload, deps: VideoDeps): Promise<VideoResult>;
  metrics(d: { externalId: string }, deps: VideoDeps): Promise<Metrics>;
}

export const RATE_BACKOFF_MS = 30 * 60_000;
export const QUOTA_BACKOFF_MS = 6 * 3_600_000;
const TIMEOUT_MS = 30_000;
const CHUNK_TIMEOUT_MS = 120_000;

type Call = { service: string; url: string; method: string; headers?: Record<string, string>; body?: BodyInit; final?: boolean; accept?: number[]; chunk?: boolean };
// The platform's reason code (TikTok error.code, Google error.errors[0].reason or error), when it looks like one.
export type Reason = (body: unknown) => string | null;

const code = (v: unknown) => (typeof v === 'string' && /^[\w.-]{1,40}$/.test(v) ? v : null);
export const reasonOf: Reason = (b) => {
  const e = (b as { error?: unknown })?.error;
  if (typeof e === 'string') return code(e);
  const x = e as { code?: unknown; errors?: { reason?: unknown }[] } | undefined;
  return code(x?.errors?.[0]?.reason) ?? code(x?.code);
};
const QUOTA = new Set(['quotaExceeded', 'uploadLimitExceeded', 'dailyLimitExceeded']);
const RATE = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'rate_limit_exceeded', 'spam_risk_too_many_posts']);

export function failure(service: string, status: number, reason: string | null, final = false): SocialPostError {
  const detail = `${service} answered HTTP ${status}${reason ? ` (${reason})` : ''}`;
  if (reason && QUOTA.has(reason)) return new SocialPostError('transient', detail, QUOTA_BACKOFF_MS);
  if (status === 429 || (reason && RATE.has(reason))) return new SocialPostError('transient', detail, RATE_BACKOFF_MS);
  if (status >= 500) return new SocialPostError(final ? 'ambiguous' : 'transient', detail);
  return new SocialPostError('permanent', detail);
}

export async function send(deps: VideoDeps, c: Call): Promise<Response> {
  let res: Response;
  try {
    res = await deps.fetch(c.url, {
      method: c.method,
      headers: c.headers,
      body: c.body,
      signal: AbortSignal.timeout(c.chunk ? CHUNK_TIMEOUT_MS : TIMEOUT_MS),
      redirect: 'manual',
    });
  } catch (err) {
    const what = (err as Error)?.name === 'TimeoutError' ? 'timed out' : 'network error';
    throw new SocialPostError(c.final ? 'ambiguous' : 'transient', `${c.service} request ${what}`);
  }
  if ((c.accept ?? []).includes(res.status) || (res.status >= 200 && res.status < 300)) return res;
  const reason = await res.json().then(reasonOf).catch(() => null);
  throw failure(c.service, res.status, reason, c.final);
}

// The JSON of a successful answer; unreadable is permanent, or ambiguous on the publishing call (5A review H1).
export async function json<T>(res: Response, service: string, final = false): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new SocialPostError(final ? 'ambiguous' : 'permanent', `${service} returned an unreadable answer`);
  }
}

export async function readChunk(filePath: string, start: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const fh = await open(filePath, 'r');
  try {
    const b = new Uint8Array(length);
    const { bytesRead } = await fh.read(b, 0, length, start);
    if (bytesRead !== length) throw new SocialPostError('permanent', 'the video file is shorter than recorded');
    return b;
  } finally {
    await fh.close();
  }
}

export const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
export const clean = (m: Metrics): Metrics => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined));
export const withTags = (text: string, tags: string[]) => [text, tags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n');
