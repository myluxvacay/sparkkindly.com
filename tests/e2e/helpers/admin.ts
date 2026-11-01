// Admin fixtures for the e2e suite: an enrolled authenticator, link tokens and sessions written straight into the e2e
// database (through the shared fixture connection), so specs can test the admin area without email. Only
// example.test addresses; the preview server runs with ADMIN_EMAILS=owner@example.test.
import { createHash, randomBytes } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { sql } from './fixtures';
import { newTotpSecret, totpAt } from '../../../lib/admin/totp';

export const OWNER = 'owner@example.test';
export const BASE = 'http://localhost:4173';
export const ORIGIN = { origin: BASE };
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
export const csrfFor = (session: string) => hash(`csrf:${session}`);

export async function enrol(email = OWNER): Promise<string> {
  const secret = newTotpSecret();
  await sql(
    `INSERT INTO admin_users (email, totp_secret) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET totp_secret = EXCLUDED.totp_secret, totp_last_step = 0`,
    [email, secret],
  );
  return secret;
}

export const codeFor = (secret: string) => totpAt(secret, Math.floor(Date.now() / 30_000));

export async function linkToken(email = OWNER): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await sql("INSERT INTO admin_login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '15 minutes')", [hash(token), email]);
  return token;
}

export async function session(stage: 'active' | 'code' = 'active', email = OWNER): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await sql(
    `INSERT INTO admin_sessions (token_hash, email, stage, expires_at, last_seen_at)
     VALUES ($1, $2, $3, now() + interval '1 hour', now())`,
    [hash(token), email, stage],
  );
  return token;
}

export async function signInContext(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([{ name: '__Host-sk_admin', value: token, url: BASE.replace('http:', 'https:') + '/', httpOnly: true, secure: true, sameSite: 'Strict' }]);
}

export const cookieHeader = (token: string) => ({ cookie: `__Host-sk_admin=${token}` });

export const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
export const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

export async function auditCount(action: string): Promise<number> {
  const r = await sql<{ n: number }>('SELECT count(*)::int AS n FROM audit_log WHERE action = $1', [action]);
  return r.rows[0].n;
}
