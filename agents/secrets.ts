import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const defaultSecretsPath = () => process.env.SPARKKINDLY_SECRETS_FILE ?? path.join(homedir(), 'sparkkindly-secrets.txt');

// Reads KEY=value lines from the owner's secrets file (outside the repository). Comments and lowercase names are
// ignored, a missing file is an empty result, and values may contain "=".
export function loadSecrets(file: string = defaultSecretsPath()): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export type Config =
  | { ok: true; baseUrl: string; agentKey: string; basicAuth?: { user: string; password: string } }
  | { ok: false; missing: string[] };

// Which site and key an environment uses. When something is missing the result names the setting, never a value.
export function resolveConfig(env: 'staging' | 'prod', secrets: Record<string, string>): Config {
  if (env !== 'staging' && env !== 'prod') return { ok: false, missing: ['a valid --env (staging or prod)'] };
  const prefix = env === 'staging' ? 'SPARKKINDLY_STAGING' : 'SPARKKINDLY_PROD';
  const missing: string[] = [];
  const url = secrets[`${prefix}_URL`];
  const key = secrets[`${prefix}_AGENT_KEY`];
  if (!url) missing.push(`${prefix}_URL`);
  if (!key) missing.push(`${prefix}_AGENT_KEY`);
  if (missing.length) return { ok: false, missing };
  if (!url.startsWith('https://')) return { ok: false, missing: [`${prefix}_URL must start with https://`] };
  const user = env === 'staging' ? secrets.STAGING_BASIC_AUTH_USER : undefined;
  const password = env === 'staging' ? secrets.STAGING_BASIC_AUTH_PASSWORD : undefined;
  return {
    ok: true,
    baseUrl: url.replace(/\/+$/, ''),
    agentKey: key,
    basicAuth: user && password ? { user, password } : undefined,
  };
}
