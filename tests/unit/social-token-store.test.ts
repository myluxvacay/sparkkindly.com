// @vitest-environment node
// The file-based token store (plan 5B Task 3) in a temp directory: an expired access token is refreshed once and the
// rotated refresh token persisted atomically (mode 0600, temp file + rename, no temp file left); two concurrent ticks
// refresh once (lock file); a refused refresh marks the platform "needs re-authorisation" and stops; a corrupt file is
// never overwritten and means re-authorisation; a missing file falls back to the env's initial refresh token; tokens
// never appear in errors.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SocialPostError } from '@/lib/social/adapters/meta';
import { accessToken, readTokens, tokenFile, tokenStatus } from '@/lib/social/token-store';

let dir: string;
let file: string;
const NOW = new Date('2026-11-05T12:00:00Z');
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sk-tokens-'));
  file = path.join(dir, 'social-tokens.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const env = () => ({ SOCIAL_TOKEN_FILE: file, TIKTOK_REFRESH_TOKEN: 'INITIAL-REFRESH-SECRET' });
const fresh = (n = 1) => vi.fn(async () => ({ accessToken: `ACCESS-${n}`, refreshToken: `ROTATED-${n}`, expiresIn: 86_400 }));
const get = (refresh: ReturnType<typeof fresh>, e: Record<string, string> = env(), now = NOW) =>
  accessToken('tiktok', { env: e, now, refresh });

async function failure(p: Promise<unknown>): Promise<SocialPostError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SocialPostError);
    return e as SocialPostError;
  }
  throw new Error('expected a failure');
}

describe('token store', () => {
  it('defaults to /opt/sparkkindly/shared/social-tokens.json', () => {
    expect(tokenFile({})).toBe('/opt/sparkkindly/shared/social-tokens.json');
    expect(tokenFile({ SOCIAL_TOKEN_FILE: file })).toBe(file);
  });

  it('a missing file uses the initial refresh token once, then persists the rotated pair with mode 0600 and no temp file', async () => {
    const refresh = fresh();
    expect(await get(refresh)).toBe('ACCESS-1');
    expect(refresh).toHaveBeenCalledWith('INITIAL-REFRESH-SECRET');
    expect(readTokens(file).tiktok).toMatchObject({ accessToken: 'ACCESS-1', refreshToken: 'ROTATED-1' });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['social-tokens.json']);
    // Still valid: no second refresh.
    expect(await get(fresh(2))).toBe('ACCESS-1');
  });

  it('an expired access token is refreshed once with the stored (rotated) refresh token', async () => {
    writeFileSync(file, JSON.stringify({ tiktok: { accessToken: 'OLD', refreshToken: 'STORED', expiresAt: NOW.getTime() - 1000 } }));
    const refresh = fresh(3);
    expect(await get(refresh)).toBe('ACCESS-3');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('STORED');
    expect(readTokens(file).tiktok?.refreshToken).toBe('ROTATED-3');
  });

  it('two concurrent ticks refresh once (the lock), both get the new token', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const refresh = vi.fn(async () => {
      await gate;
      return { accessToken: 'ACCESS-X', refreshToken: 'ROTATED-X', expiresIn: 3600 };
    });
    const a = get(refresh as never);
    const b = get(refresh as never);
    await new Promise((r) => setTimeout(r, 30));
    release();
    expect(await Promise.all([a, b])).toEqual(['ACCESS-X', 'ACCESS-X']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a refused refresh marks needs re-authorisation, stops further refreshes, and the error carries no token', async () => {
    const refuse = vi.fn(async () => {
      throw new SocialPostError('credentials', 'refresh refused');
    });
    const e = await failure(get(refuse as never));
    expect(e.kind).toBe('credentials');
    expect(e.message).toMatch(/re-authori[sz]ation/);
    expect(e.message).not.toMatch(/SECRET|ROTATED|INITIAL/);
    expect(tokenStatus('tiktok', env())).toBe('reauth');
    const again = fresh();
    await failure(get(again));
    expect(again).not.toHaveBeenCalled();
  });

  it('a transient refresh failure does not mark the platform', async () => {
    const flaky = vi.fn(async () => {
      throw new SocialPostError('transient', 'TikTok request timed out');
    });
    expect((await failure(get(flaky as never))).kind).toBe('transient');
    expect(tokenStatus('tiktok', env())).toBe('ok');
  });

  it('a corrupt file means re-authorisation and is never overwritten', async () => {
    writeFileSync(file, '{not json');
    const refresh = fresh();
    expect((await failure(get(refresh))).message).toMatch(/re-authori[sz]ation/);
    expect(refresh).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe('{not json');
    expect(tokenStatus('tiktok', env())).toBe('reauth');
  });

  it('no file and no initial refresh token: missing', () => {
    expect(tokenStatus('youtube', { SOCIAL_TOKEN_FILE: file })).toBe('missing');
    expect(tokenStatus('youtube', { SOCIAL_TOKEN_FILE: file, YOUTUBE_REFRESH_TOKEN: 'x' })).toBe('ok');
  });
});
