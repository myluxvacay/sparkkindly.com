import { describe, it, expect } from 'vitest';
import { getHealth, viewFor, isInternalHost } from '@/lib/health';
import { missingEnv } from '@/lib/env';

const fullEnv = {
  DATABASE_URL: 'postgres://x',
  MAILERSEND_API_TOKEN: 't',
  MAIL_FROM: 'hello@sparkkindly.com',
  SITE_RELEASE: 'true',
};

describe('health', () => {
  it('is ok when db responds and env is complete', async () => {
    const h = await getHealth({ env: fullEnv, checkDb: async () => {}, release: 'abc1234' });
    expect(h).toEqual({ ok: true, release: 'abc1234', db: 'ok', missingEnv: [] });
  });

  it('fails when db throws', async () => {
    const h = await getHealth({
      env: fullEnv,
      checkDb: async () => {
        throw new Error('down');
      },
      release: 'abc1234',
    });
    expect(h.ok).toBe(false);
    expect(h.db).toBe('error');
  });

  it('fails and names missing env vars', async () => {
    const env = { ...fullEnv, MAIL_FROM: undefined };
    const h = await getHealth({ env, checkDb: async () => {}, release: 'abc1234' });
    expect(h.ok).toBe(false);
    expect(h.missingEnv).toEqual(['MAIL_FROM']);
  });

  it('shows full detail to internal callers and only ok to callers that came through the proxy', () => {
    const h = { ok: false, release: 'abc1234', db: 'error' as const, missingEnv: ['MAIL_FROM'] };
    expect(viewFor(h, true)).toEqual(h);
    expect(viewFor(h, false)).toEqual({ ok: false });
  });

  it('treats only loopback hosts as internal callers', () => {
    expect(isInternalHost('127.0.0.1:3100')).toBe(true);
    expect(isInternalHost('localhost:3101')).toBe(true);
    expect(isInternalHost('[::1]:3100')).toBe(true);
    expect(isInternalHost('sparkkindly.com')).toBe(false);
    expect(isInternalHost('staging.sparkkindly.com')).toBe(false);
    expect(isInternalHost('127.0.0.1.evil.com')).toBe(false);
    expect(isInternalHost(null)).toBe(false);
  });

  it('missingEnv lists every absent required variable in order', () => {
    expect(missingEnv({})).toEqual(['DATABASE_URL', 'MAILERSEND_API_TOKEN', 'MAIL_FROM', 'SITE_RELEASE']);
  });
});
