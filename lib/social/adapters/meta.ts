// The Meta Graph API adapters (plan 5A): Instagram (media container with image_url and caption, a bounded status poll,
// publish, then the permalink) and Facebook (one Page photo post with the text, which carries the link). Credentials come
// from META_PAGE_ACCESS_TOKEN, META_PAGE_ID and META_IG_USER_ID at call time only; missing ones are refused before any
// request. The token travels only in the Authorization header, never in a URL; errors carry the HTTP status and the
// Graph error code only, never a token, caption or response text. Every call has a 15 s timeout and follows no redirect.
// Failure kinds: transient (429, 5xx, network, still processing) is retried by the poster; permanent (other 4xx, an
// expired token, a failed container) fails at once; ambiguous (the final publishing call failed in a way the platform
// may still have acted on, or answered 200 with nothing usable) is flagged for the owner and never retried.
// No Next.js imports.
// Verified by tests/unit/social-meta-adapter.test.ts.
import type { EnvLike } from '@/lib/env';
import type { Platform } from '../states';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 15_000;
const POLL_TRIES = 5;
const POLL_WAIT_MS = 3_000;

export type FailureKind = 'transient' | 'permanent' | 'credentials' | 'ambiguous';
// backoffMs (plan 5B): a quota or rate limit asks the poster to wait longer than its usual 5 minutes.
export class SocialPostError extends Error {
  constructor(public readonly kind: FailureKind, message: string, public readonly backoffMs?: number) {
    super(message);
    this.name = 'SocialPostError';
  }
}

export type AdapterDeps = { fetch: typeof fetch; env: EnvLike; sleep?: (ms: number) => Promise<void> };
export type PostPayload = { text: string; imageUrl: string };
export type Metrics = { reach?: number; likes?: number; comments?: number; views?: number };
export interface PlatformAdapter {
  post(d: PostPayload, deps: AdapterDeps): Promise<{ externalId: string; url: string | null }>;
  metrics(d: { externalId: string }, deps: AdapterDeps): Promise<Metrics>;
}

const NEEDS: Partial<Record<Platform, string[]>> = {
  instagram: ['META_PAGE_ACCESS_TOKEN', 'META_IG_USER_ID'],
  facebook: ['META_PAGE_ACCESS_TOKEN', 'META_PAGE_ID'],
};
export const hasCredentials = (platform: Platform, env: EnvLike): boolean =>
  !!NEEDS[platform]?.every((name) => (env[name] ?? '').trim() !== '');

function credentials(platform: Platform, env: EnvLike) {
  if (!hasCredentials(platform, env)) throw new SocialPostError('credentials', 'no credentials');
  return { token: env.META_PAGE_ACCESS_TOKEN!.trim(), pageId: (env.META_PAGE_ID ?? '').trim(), igUserId: (env.META_IG_USER_ID ?? '').trim() };
}

type Call = { deps: AdapterDeps; token: string; path: string; form?: Record<string, string>; final?: boolean };

// One Graph call. `final` marks the call that publishes: a failure there other than 429 or a clear 4xx may have posted.
async function graph<T>({ deps, token, path, form, final }: Call): Promise<T> {
  let res: Response;
  try {
    res = await deps.fetch(`${GRAPH}/${path}`, {
      method: form ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
    });
  } catch (err) {
    const what = (err as Error)?.name === 'TimeoutError' ? 'timed out' : 'network error';
    throw new SocialPostError(final ? 'ambiguous' : 'transient', `Meta request ${what}`);
  }
  if (res.ok) {
    // A 200 from the publishing call that cannot be read may still have posted (5A review H1): never retried.
    try {
      return (await res.json()) as T;
    } catch {
      throw new SocialPostError(final ? 'ambiguous' : 'transient', 'Meta returned an unreadable answer');
    }
  }
  const code = await res
    .json()
    .then((b: { error?: { code?: unknown } }) => (typeof b?.error?.code === 'number' ? b.error.code : null))
    .catch(() => null);
  const detail = `Meta answered HTTP ${res.status}${code === null ? '' : ` (code ${code})`}`;
  if (code === 190) throw new SocialPostError('permanent', `${detail}: the page token is invalid or expired`);
  if (res.status === 429) throw new SocialPostError('transient', detail);
  if (res.status >= 500) throw new SocialPostError(final ? 'ambiguous' : 'transient', detail);
  throw new SocialPostError('permanent', detail);
}

// `kind` is 'ambiguous' for the publishing call's answer: without a usable id we cannot tell whether it posted.
const idOf = (v: unknown, kind: FailureKind = 'permanent'): string => {
  const id = (v as { id?: unknown })?.id;
  if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) throw new SocialPostError(kind, 'Meta returned no usable id');
  return id;
};

async function waitForContainer(deps: AdapterDeps, token: string, id: string): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 0; i < POLL_TRIES; i++) {
    const s = await graph<{ status_code?: string }>({ deps, token, path: `${id}?fields=status_code` });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new SocialPostError('permanent', 'Instagram could not process the image');
    await sleep(POLL_WAIT_MS);
  }
  throw new SocialPostError('transient', 'Instagram was still processing the image');
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
async function reach(deps: AdapterDeps, token: string, id: string, metric: string): Promise<number | undefined> {
  try {
    const r = await graph<{ data?: { values?: { value?: unknown }[] }[] }>({ deps, token, path: `${id}/insights?metric=${metric}` });
    return num(r.data?.[0]?.values?.[0]?.value);
  } catch {
    return undefined;
  }
}
const clean = (m: Metrics): Metrics => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined));

export const instagram: PlatformAdapter = {
  async post(d, deps) {
    const { token, igUserId } = credentials('instagram', deps.env);
    const container = idOf(await graph({ deps, token, path: `${igUserId}/media`, form: { image_url: d.imageUrl, caption: d.text } }));
    await waitForContainer(deps, token, container);
    const media = idOf(await graph({ deps, token, path: `${igUserId}/media_publish`, form: { creation_id: container }, final: true }), 'ambiguous');
    const link = await graph<{ permalink?: unknown }>({ deps, token, path: `${media}?fields=permalink` }).catch(() => null);
    const url = typeof link?.permalink === 'string' && link.permalink.startsWith('https://') ? link.permalink : null;
    return { externalId: media, url };
  },
  async metrics(d, deps) {
    const { token } = credentials('instagram', deps.env);
    const m = await graph<{ like_count?: unknown; comments_count?: unknown }>({ deps, token, path: `${d.externalId}?fields=like_count,comments_count` });
    return clean({ likes: num(m.like_count), comments: num(m.comments_count), reach: await reach(deps, token, d.externalId, 'reach') });
  },
};

export const facebook: PlatformAdapter = {
  async post(d, deps) {
    const { token, pageId } = credentials('facebook', deps.env);
    const r = await graph<{ post_id?: unknown }>({ deps, token, path: `${pageId}/photos`, form: { url: d.imageUrl, message: d.text }, final: true });
    const postId = idOf({ id: r.post_id }, 'ambiguous');
    return { externalId: postId, url: `https://www.facebook.com/${postId}` };
  },
  async metrics(d, deps) {
    const { token } = credentials('facebook', deps.env);
    type Totals = { reactions?: { summary?: { total_count?: unknown } }; comments?: { summary?: { total_count?: unknown } } };
    const m = await graph<Totals>({ deps, token, path: `${d.externalId}?fields=reactions.summary(total_count),comments.summary(total_count)` });
    return clean({
      likes: num(m.reactions?.summary?.total_count),
      comments: num(m.comments?.summary?.total_count),
      reach: await reach(deps, token, d.externalId, 'post_impressions_unique'),
    });
  },
};

// The platforms Part A posts to; TikTok and YouTube adapters are Part B.
export const ADAPTERS: Partial<Record<Platform, PlatformAdapter>> = { instagram, facebook };
