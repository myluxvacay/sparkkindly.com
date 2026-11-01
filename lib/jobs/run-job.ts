import type { Queryable } from '@/lib/db';

type Options = { attempts?: number; delayMs?: number };

// Runs a scheduled job with retries (the wait grows each time: delayMs, 2x, 3x...). If every attempt fails, the failure
// is recorded in failed_jobs (message only, never a stack trace) and the function returns normally: the worker that
// calls this must keep running. Writing the failure row is itself best-effort.
export async function runJob(db: Queryable, name: string, fn: () => Promise<unknown>, opts: Options = {}): Promise<void> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 1000;
  let lastMessage = 'unknown error';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastMessage = err instanceof Error ? err.message : String(err);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  try {
    await db.query('INSERT INTO failed_jobs (job, payload, error, attempts) VALUES ($1, $2::jsonb, $3, $4)', [
      name, JSON.stringify({}), lastMessage, attempts,
    ]);
  } catch (err) {
    console.error(`job ${name} failed and the failure could not be recorded:`, (err as Error).message);
  }
}
