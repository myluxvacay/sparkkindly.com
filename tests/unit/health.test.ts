import { describe, it, expect } from 'vitest';
import { getHealth } from '@/lib/health';
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

  it('missingEnv lists every absent required variable in order', () => {
    expect(missingEnv({})).toEqual(['DATABASE_URL', 'MAILERSEND_API_TOKEN', 'MAIL_FROM', 'SITE_RELEASE']);
  });
});
