import type { Queryable } from '@/lib/db';
import type { AgentRole } from './auth';
import { generateKey } from './keys';

export class UnknownWorldError extends Error {
  constructor(slug: string) {
    super(`There is no world called "${slug}"`);
    this.name = 'UnknownWorldError';
  }
}

// Creates an agent and returns its key, once. worldSlug null makes a master agent that names the world per request.
// A moderation agent (plan 7B) works on comments only and is never tied to a world.
export async function createAgent(
  db: Queryable,
  name: string,
  worldSlug: string | null,
  role: AgentRole = 'content',
): Promise<{ id: number; key: string }> {
  if (role !== 'content' && role !== 'moderation') throw new Error('An agent role is content or moderation');
  if (role === 'moderation' && worldSlug !== null) throw new Error('A moderation agent is not tied to a world');
  let worldId: number | null = null;
  if (worldSlug !== null) {
    const w = await db.query<{ id: number }>('SELECT id FROM worlds WHERE slug = $1', [worldSlug]);
    if (!w.rows[0]) throw new UnknownWorldError(worldSlug);
    worldId = w.rows[0].id;
  }
  const existing = await db.query('SELECT 1 FROM agents WHERE name = $1', [name]);
  if (existing.rows.length) throw new Error(`An agent named "${name}" already exists`);
  const { key, prefix, hash } = generateKey();
  const r = await db.query<{ id: number }>(
    'INSERT INTO agents (name, world_id, key_prefix, key_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [name, worldId, prefix, hash, role],
  );
  return { id: r.rows[0].id, key };
}
