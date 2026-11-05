// @vitest-environment node
// Flag-off differences (Project 4 final review 6): with ACCOUNTS_ENABLED on and CIRCLES_ENABLED off, every /circles/*
// route and page is a 404 before anything reads a session or the database, the share prompt does no context lookup, and
// the settings page says nothing about circle emails.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const getContext = vi.fn();
vi.mock('@/lib/accounts/context', async (orig) => ({ ...(await orig<object>()), getContext }));
vi.mock('@/lib/accounts/scope-next', async (orig) => ({ ...(await orig<object>()), accountSessionToken: async () => 'a'.repeat(64) }));
// A request's cookie store, as a page sees it outside Next (a page may read the cookie; it must still 404).
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'a'.repeat(64) }) }),
  headers: async () => new Headers({ host: 'localhost' }),
}));
// Deliberately flag-free (the opt-out link already sent in an invite email must always work): stop-invites.
const ALWAYS_ON = /\/stop-invites\//;

const files = (dir: string, name: RegExp): string[] =>
  readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => name.test(path.basename(f)))
    .map((f) => path.join(dir, f).split(path.sep).join('/'))
    .filter((f) => !ALWAYS_ON.test(f));
const params = { params: Promise.resolve({ slug: 'abcdefghij', token: 'x' }), searchParams: Promise.resolve({}) };
const req = (method: string) =>
  new Request('http://localhost/circles/x/', {
    method,
    headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/x-www-form-urlencoded', cookie: `__Host-sk_account=${'a'.repeat(64)}` },
    ...(method === 'POST' ? { body: 'confirm=on' } : {}),
  });
const is404 = (err: unknown) => String((err as { digest?: string })?.digest ?? '').includes('404');

beforeEach(() => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('CIRCLES_ENABLED', '');
  vi.stubEnv('DATABASE_URL', 'postgres://nobody@127.0.0.1:1/none');
  getContext.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('circles off', () => {
  it.each(files('app/circles', /^route\.tsx?$/))('%s answers 404 to every method', async (file) => {
    const mod = (await import(`@/${file.replace(/\.tsx?$/, '')}`)) as Record<string, (r: Request, p: typeof params) => Promise<Response>>;
    const methods = ['GET', 'POST'].filter((m) => typeof mod[m] === 'function');
    expect(methods.length).toBeGreaterThan(0);
    for (const m of methods) expect((await mod[m](req(m), params)).status, `${file} ${m}`).toBe(404);
    expect(getContext).not.toHaveBeenCalled();
  });

  it.each(files('app/circles', /^page\.tsx$/))('%s is a 404', async (file) => {
    const mod = (await import(`@/${file.replace(/\.tsx$/, '')}`)) as { default: (p: typeof params) => Promise<unknown> };
    const err = await mod.default(params).then(
      () => null,
      (e: unknown) => e,
    );
    expect(is404(err), `${file}: ${String(err)}`).toBe(true);
    expect(getContext).not.toHaveBeenCalled();
  });

  it('the share prompt returns nothing without a context lookup', async () => {
    const { default: SharePrompt } = await import('@/components/item/SharePrompt');
    expect(await SharePrompt({ itemId: '00000000-0000-0000-0000-000000000001' })).toBeNull();
    expect(getContext).not.toHaveBeenCalled();
  });

  it('the settings page mentions circle emails only when circles are on', () => {
    const src = readFileSync('app/account/settings/page.tsx', 'utf8');
    expect(src).toMatch(/circlesEnabled\(\) && \(?\s*<p id="notify-hint">/);
  });
});
