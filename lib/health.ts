import { missingEnv, type EnvLike } from './env';

export type Health = {
  ok: boolean;
  release: string;
  db: 'ok' | 'error';
  missingEnv: string[];
};

type HealthDeps = {
  env: EnvLike;
  checkDb: () => Promise<void>;
  release: string;
};

// Internal callers (the deploy script and on-box checks) curl the app directly on loopback, so their Host header
// is a loopback address. Public traffic arrives through Caddy, which forwards the public hostname, and a visitor
// cannot make Caddy proxy to the app under a loopback Host because no site block matches it.
// (X-Forwarded-For cannot be used for this: Next's own server adds it to every request.)
export function isInternalHost(host: string | null): boolean {
  return host !== null && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
}

// Internal callers get the full report. Everyone else gets only ok, so the public cannot read the release SHA,
// the database state or which configuration is missing.
export function viewFor(health: Health, internal: boolean): Health | { ok: boolean } {
  return internal ? health : { ok: health.ok };
}

// Pure: the only I/O is the injected checkDb, so this is unit-testable without a database.
export async function getHealth({ env, checkDb, release }: HealthDeps): Promise<Health> {
  let db: Health['db'] = 'ok';
  try {
    await checkDb();
  } catch {
    db = 'error';
  }
  const missing = missingEnv(env);
  return { ok: db === 'ok' && missing.length === 0, release, db, missingEnv: missing };
}
