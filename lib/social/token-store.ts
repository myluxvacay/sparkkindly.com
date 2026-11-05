// The rotating TikTok and YouTube tokens (plan 5B, security.md), kept in one JSON file at SOCIAL_TOKEN_FILE (default
// /opt/sparkkindly/shared/social-tokens/tokens.json, in a 0700 directory of the service user; file mode 0600), never in the database, the repo,
// a log, a prompt or the export. Client ids and secrets and the first refresh token come from the env file; after the
// first refresh the store keeps the (rotated) refresh token. Every read-refresh-write happens under a lock file
// (`<file>.lock`, created exclusively; a lock older than two minutes is stale), so two worker ticks refresh once. Writes
// go to a temp file (0600) that is renamed over the store. A refresh the platform refuses marks the platform "needs
// re-authorisation" (shown in /admin; posting stops for it); a corrupt file means the same and is never overwritten;
// a missing file falls back to the env's first refresh token. Errors never carry a token. No Next.js imports.
// Verified by tests/unit/social-token-store.test.ts.
import { randomBytes } from 'node:crypto';
import { accessSync, constants, readFileSync } from 'node:fs';
import path from 'node:path';
import { chmod, rename, rm, writeFile } from 'node:fs/promises';
import { acquireLock } from './lockfile';
import type { EnvLike } from '@/lib/env';
import { SocialPostError } from './adapters/meta';
import type { VideoPlatform } from './states';

export type TokenEntry = { accessToken?: string; refreshToken?: string; expiresAt?: number; needsReauth?: boolean };
type Store = Partial<Record<VideoPlatform, TokenEntry>>;
export type Refresher = (refreshToken: string) => Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }>;

// Its own directory, owned by the service user, mode 0700 (5B review M1); staging sets its own path.
const DEFAULT_FILE = '/opt/sparkkindly/shared/social-tokens/tokens.json';
const ENV_REFRESH: Record<VideoPlatform, string> = { tiktok: 'TIKTOK_REFRESH_TOKEN', youtube: 'YOUTUBE_REFRESH_TOKEN' };
const EARLY_MS = 60_000; // refresh a minute before expiry
const STALE_LOCK_MS = 120_000;
const LOCK_TRIES = 200;
const LOCK_WAIT_MS = 50;

export const tokenFile = (env: EnvLike): string => (env.SOCIAL_TOKEN_FILE ?? '').trim() || DEFAULT_FILE;

class CorruptStore extends Error {}
const reauth = () => new SocialPostError('credentials', 'needs re-authorisation: sign in to the platform again (docs/OPERATIONS.md, Video jobs)');

export function readTokens(file: string): Store {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new CorruptStore('unreadable');
  }
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('shape');
    return v as Store;
  } catch {
    throw new CorruptStore('corrupt');
  }
}

async function writeTokens(file: string, store: Store): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(store), { mode: 0o600, flag: 'wx' });
    await chmod(tmp, 0o600);
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < LOCK_TRIES; i++) {
    const release = await acquireLock(`${file}.lock`, STALE_LOCK_MS).catch(() => {
      throw new SocialPostError('credentials', UNAVAILABLE);
    });
    if (!release) {
      await sleep(LOCK_WAIT_MS);
      continue;
    }
    try {
      return await fn();
    } finally {
      await release();
    }
  }
  throw new SocialPostError('transient', 'token store busy');
}

const UNAVAILABLE = 'token store unavailable: its directory is missing or not writable (docs/OPERATIONS.md, Video jobs)';
// The store's directory must exist and be writable by this process, or refreshed tokens could not be kept: fail closed.
function writable(file: string): boolean {
  try {
    accessSync(path.dirname(file), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// 'ok' (a token or a refresh token to get one), 'missing' (nothing yet), 'reauth' (refused or corrupt) or
// 'unavailable' (the directory is missing or not writable).
export function tokenStatus(platform: VideoPlatform, env: EnvLike): 'ok' | 'missing' | 'reauth' | 'unavailable' {
  if (!writable(tokenFile(env))) return 'unavailable';
  let entry: TokenEntry | undefined;
  try {
    entry = readTokens(tokenFile(env))[platform];
  } catch {
    return 'reauth';
  }
  if (entry?.needsReauth) return 'reauth';
  return entry?.refreshToken || (env[ENV_REFRESH[platform]] ?? '').trim() ? 'ok' : 'missing';
}

// A valid access token for the platform, refreshed (once, under the lock) when it is missing or about to expire.
export async function accessToken(platform: VideoPlatform, o: { env: EnvLike; now: Date; refresh: Refresher }): Promise<string> {
  const file = tokenFile(o.env);
  if (!writable(file)) throw new SocialPostError('credentials', UNAVAILABLE);
  return withLock(file, async () => {
    let store: Store;
    try {
      store = readTokens(file);
    } catch {
      throw reauth();
    }
    const entry = store[platform] ?? {};
    if (entry.needsReauth) throw reauth();
    if (entry.accessToken && (entry.expiresAt ?? 0) > o.now.getTime() + EARLY_MS) return entry.accessToken;
    const refreshToken = entry.refreshToken || (o.env[ENV_REFRESH[platform]] ?? '').trim();
    if (!refreshToken) throw new SocialPostError('credentials', 'no credentials');
    let next: Awaited<ReturnType<Refresher>>;
    try {
      next = await o.refresh(refreshToken);
    } catch (err) {
      const refused = err instanceof SocialPostError && (err.kind === 'credentials' || err.kind === 'permanent');
      if (!refused) throw err instanceof SocialPostError ? err : new SocialPostError('transient', 'token refresh failed');
      await writeTokens(file, { ...store, [platform]: { refreshToken, needsReauth: true } });
      throw reauth();
    }
    const expiresAt = o.now.getTime() + Math.max(0, next.expiresIn) * 1000;
    await writeTokens(file, { ...store, [platform]: { accessToken: next.accessToken, refreshToken: next.refreshToken || refreshToken, expiresAt } });
    return next.accessToken;
  });
}
