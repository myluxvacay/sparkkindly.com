// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSecrets, resolveConfig } from '@/agents/secrets';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  delete process.env.SPARKKINDLY_SECRETS_FILE;
});
const file = (text: string) => {
  dir = mkdtempSync(path.join(tmpdir(), 'secrets-'));
  const p = path.join(dir, 'secrets.txt');
  writeFileSync(p, text);
  return p;
};

describe('loadSecrets', () => {
  it('parses KEY=value lines and ignores comments and blank lines', () => {
    const p = file('# a comment\n\nA_KEY=one\n  B_KEY = two  \nEMPTY=\nlowercase=ignored\n# C=hidden\n');
    expect(loadSecrets(p)).toEqual({ A_KEY: 'one', B_KEY: 'two', EMPTY: '' });
  });

  it('keeps equals signs inside a value and handles Windows line endings', () => {
    expect(loadSecrets(file('TOKEN=abc=def==\r\nOTHER=x\r\n'))).toEqual({ TOKEN: 'abc=def==', OTHER: 'x' });
  });

  it('returns an empty object for a missing file', () => {
    expect(loadSecrets(path.join(tmpdir(), 'definitely-not-here', 'secrets.txt'))).toEqual({});
  });

  it('reads the path from SPARKKINDLY_SECRETS_FILE when none is given', () => {
    process.env.SPARKKINDLY_SECRETS_FILE = file('A=1');
    expect(loadSecrets()).toEqual({ A: '1' });
  });
});

describe('resolveConfig', () => {
  const full = {
    SPARKKINDLY_STAGING_URL: 'https://staging.sparkkindly.com/', SPARKKINDLY_STAGING_AGENT_KEY: 'skagt_k',
    STAGING_BASIC_AUTH_USER: 'u', STAGING_BASIC_AUTH_PASSWORD: 'p',
    SPARKKINDLY_PROD_URL: 'https://sparkkindly.com', SPARKKINDLY_PROD_AGENT_KEY: 'skagt_p',
  };

  it('builds the staging configuration with its basic-auth login', () => {
    expect(resolveConfig('staging', full)).toEqual({
      ok: true, baseUrl: 'https://staging.sparkkindly.com', agentKey: 'skagt_k', basicAuth: { user: 'u', password: 'p' },
    });
  });

  it('builds the production configuration with no basic auth', () => {
    expect(resolveConfig('prod', full)).toEqual({ ok: true, baseUrl: 'https://sparkkindly.com', agentKey: 'skagt_p', basicAuth: undefined });
  });

  it('names exactly the settings that are missing, never their values', () => {
    const r = resolveConfig('staging', { SPARKKINDLY_STAGING_URL: 'https://x.example', STAGING_BASIC_AUTH_USER: 'only-user' });
    expect(r).toEqual({ ok: false, missing: ['SPARKKINDLY_STAGING_AGENT_KEY'] });
    expect(JSON.stringify(r)).not.toContain('only-user');
    expect(resolveConfig('prod', {})).toEqual({ ok: false, missing: ['SPARKKINDLY_PROD_URL', 'SPARKKINDLY_PROD_AGENT_KEY'] });
  });

  it('refuses to use basic auth when only one half of it is set', () => {
    const r = resolveConfig('staging', { ...full, STAGING_BASIC_AUTH_PASSWORD: '' });
    expect(r).toMatchObject({ ok: true, basicAuth: undefined });
  });

  it('rejects an unknown environment and an insecure production URL', () => {
    expect(resolveConfig('dev' as never, full)).toEqual({ ok: false, missing: ['a valid --env (staging or prod)'] });
    expect(resolveConfig('prod', { ...full, SPARKKINDLY_PROD_URL: 'http://sparkkindly.com' })).toEqual({ ok: false, missing: ['SPARKKINDLY_PROD_URL must start with https://'] });
  });
});
