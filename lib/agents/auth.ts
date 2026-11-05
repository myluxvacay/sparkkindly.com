import { timingSafeEqual } from 'node:crypto';
import type { Queryable } from '@/lib/db';
import { hashSecret, parseKey } from './keys';

// role: 'content' agents use the item, brief and run routes; 'moderation' agents only the comment moderation routes;
// 'reviewer' agents only the contribution review routes (plan 8 review H1).
export type AgentRole = 'content' | 'moderation' | 'reviewer' | 'promoter';
export type Agent = { id: number; name: string; worldId: number | null; worldSlug: string | null; role: AgentRole };

const UNKNOWN_HASH = hashSecret('no such agent'); // compared when the prefix is unknown, so timing does not reveal it

// `header` is the value of the X-Agent-Key header (never Authorization: staging's basic auth uses that one).
export async function authenticate(db: Queryable, header: string | null, now: Date = new Date()): Promise<Agent | null> {
  const parsed = header ? parseKey(header) : null;
  if (!parsed) return null;
  const r = await db.query<{ id: number; name: string; world_id: number | null; key_hash: string; enabled: boolean; slug: string | null; role: AgentRole }>(
    `SELECT a.id, a.name, a.world_id, a.key_hash, a.enabled, w.slug, a.role
     FROM agents a LEFT JOIN worlds w ON w.id = a.world_id WHERE a.key_prefix = $1`,
    [parsed.prefix],
  );
  const row = r.rows[0];
  const stored = Buffer.from(row?.key_hash ?? UNKNOWN_HASH, 'hex');
  const given = Buffer.from(hashSecret(parsed.secret), 'hex');
  const same = stored.length === given.length && timingSafeEqual(stored, given);
  if (!row || !same || !row.enabled) return null;
  await db.query(
    `UPDATE agents SET last_run_at = $2 WHERE id = $1 AND (last_run_at IS NULL OR last_run_at < $2::timestamptz - interval '1 minute')`,
    [row.id, now.toISOString()],
  );
  return { id: row.id, name: row.name, worldId: row.world_id, worldSlug: row.slug, role: row.role };
}
