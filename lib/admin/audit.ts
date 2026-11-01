import type { Queryable } from '@/lib/db';

// One audit_log row. Call it with the same transaction as the change it records. `detail` must never carry a key,
// token, hash or secret: the callers pass only ids, names and the fields that changed.
export async function audit(
  tx: Queryable,
  actor: string,
  action: string,
  target: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await tx.query('INSERT INTO audit_log (actor, action, target, detail) VALUES ($1, $2, $3, $4::jsonb)', [
    actor,
    action,
    target,
    JSON.stringify(detail),
  ]);
}
