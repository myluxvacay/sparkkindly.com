import type { Queryable } from '@/lib/db';
import { worldSeeds } from './worlds';
import { topicParents, topicChildren, topicRoots } from './topics';

// Inserts the launch worlds and curated topics. Existing rows are left exactly as they are, so a value the owner
// changed in /admin (a world's approval mode or buffer, a renamed topic) survives a re-run.
export async function seedReference(db: Queryable): Promise<void> {
  for (const w of worldSeeds) {
    await db.query(
      `INSERT INTO worlds (slug, name, promise, description, icon, color, sort, approval_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO NOTHING`,
      [w.slug, w.name, w.promise, w.description, w.icon, w.color, w.sort, w.approvalMode],
    );
  }
  const insertTopic = (slug: string, name: string, parent: string | null) =>
    db.query(
      `INSERT INTO topics (slug, name, parent_id)
       VALUES ($1, $2, (SELECT id FROM topics WHERE slug = $3))
       ON CONFLICT (slug) DO NOTHING`,
      [slug, name, parent],
    );
  for (const [slug, name] of Object.entries(topicRoots)) await insertTopic(slug, name, null);
  for (const [slug, name] of Object.entries(topicParents)) await insertTopic(slug, name, null);
  for (const [parent, children] of Object.entries(topicChildren)) {
    for (const [slug, name] of Object.entries(children)) await insertTopic(slug, name, parent);
  }
}
