// Syncs the stored topic links of already-imported articles from the content files. The legacy import
// is insert-only (ON CONFLICT DO NOTHING), and it links an article's tags to topics by slug — a tag
// with no topic row at import time is dropped for good. When a tag later becomes a topic (the reading
// series' structural tags, migration 043), existing rows therefore keep missing links until this sync
// adds them; it is the deliberate, guarded counterpart used when the topic list grows, exactly as
// updateHeroImages is for artwork. Insert-only itself: a link an owner added or removed in /admin is
// never second-guessed here — this only adds links the content files declare and the topics table now
// knows. Only item_topics rows for kind = 'article' are touched, matched by world + slug; titles,
// bodies, status and answers are never rewritten here.
// Verified by tests/unit/update-topics.test.ts.
import type { Db } from '@/lib/db';
import type { Article } from '@/lib/schemas';

export type TopicSyncResult = { added: number; unchanged: number; missing: number };

export async function updateItemTopics(db: Db, articles: Article[]): Promise<TopicSyncResult> {
  let added = 0;
  let unchanged = 0;
  let missing = 0;
  for (const a of articles) {
    const r = await db.query<{ id: string }>(
      `SELECT i.id FROM items i JOIN worlds w ON w.id = i.world_id
       WHERE w.slug = $1 AND i.slug = $2 AND i.kind = 'article'`,
      [a.brand, a.slug],
    );
    const row = r.rows[0];
    if (!row) {
      missing++;
      continue;
    }
    if (!a.tags.length) {
      unchanged++;
      continue;
    }
    const inserted = await db.query<{ topic_id: number }>(
      `INSERT INTO item_topics (item_id, topic_id)
       SELECT $1, id FROM topics WHERE slug = ANY($2)
       ON CONFLICT DO NOTHING
       RETURNING topic_id`,
      [row.id, a.tags],
    );
    if (inserted.rows.length) added += inserted.rows.length;
    else unchanged++;
  }
  return { added, unchanged, missing };
}
