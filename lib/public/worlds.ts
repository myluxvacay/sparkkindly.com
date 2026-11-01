import type { Queryable } from '@/lib/db';

export type World = {
  slug: string;
  name: string;
  promise: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  sort: number;
};

const COLUMNS = 'slug, name, promise, description, icon, color, sort';

// Only enabled worlds are public.
export async function listWorlds(db: Queryable): Promise<World[]> {
  const r = await db.query<World>(`SELECT ${COLUMNS} FROM worlds WHERE enabled ORDER BY sort, slug`);
  return r.rows;
}

export async function getWorld(db: Queryable, slug: string): Promise<World | null> {
  const r = await db.query<World>(`SELECT ${COLUMNS} FROM worlds WHERE enabled AND slug = $1`, [slug]);
  return r.rows[0] ?? null;
}

export async function getTopic(db: Queryable, slug: string): Promise<{ slug: string; name: string } | null> {
  const r = await db.query<{ slug: string; name: string }>('SELECT slug, name FROM topics WHERE slug = $1', [slug]);
  return r.rows[0] ?? null;
}
