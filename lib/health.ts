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
