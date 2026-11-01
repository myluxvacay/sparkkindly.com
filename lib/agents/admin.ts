import type { Queryable } from '@/lib/db';
import { generateKey } from './keys';

export class UnknownWorldError extends Error {
  constructor(slug: string) {
    super(`There is no world called "${slug}"`);
    this.name = 'UnknownWorldError';
  }
}

// Creates an agent and returns its key, once. worldSlug null makes a master agent that names the world per request.
export async function createAgent(db: Queryable, name: string, worldSlug: string | null): Promise<{ id: number; key: string }> {
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
    'INSERT INTO agents (name, world_id, key_prefix, key_hash) VALUES ($1, $2, $3, $4) RETURNING id',
    [name, worldId, prefix, hash],
  );
  return { id: r.rows[0].id, key };
}
