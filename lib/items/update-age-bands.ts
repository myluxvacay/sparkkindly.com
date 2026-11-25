// Syncs the stored age-band topic links of already-imported items from the content files'
// ageBands fields (24 Nov 2026). The legacy import is insert-only (ON CONFLICT DO NOTHING), so
// an item imported before age bands existed keeps no band links until this sync adds them; it
// is the deliberate, guarded counterpart used when the band assignments land, exactly as
// updateItemTopics is for article tags and updateGameItems is for game rows. Insert-only
// itself: a link an owner added or removed in /admin is never second-guessed here — this only
// adds the band links the content files declare. All three library kinds are touched, matched
// by world + slug + kind; titles, bodies, status and answers are never rewritten here.
// Verified by tests/unit/update-age-bands.test.ts.
import type { Db } from '@/lib/db';
import type { Article, Game, Quiz } from '@/lib/schemas';
import { bandTopicsFor, type AgeBand } from '@/lib/age-bands';

export type AgeBandSyncResult = { added: number; unchanged: number; missing: number };

type BandedItem = { brand: string; slug: string; ageBands?: AgeBand[] };

async function syncKind(db: Db, kind: 'article' | 'quiz' | 'game', items: BandedItem[], result: AgeBandSyncResult): Promise<void> {
  for (const item of items) {
    const topics = bandTopicsFor(item.ageBands);
    if (!topics.length) {
      result.unchanged++;
      continue;
    }
    const r = await db.query<{ id: string }>(
      `SELECT i.id FROM items i JOIN worlds w ON w.id = i.world_id
       WHERE w.slug = $1 AND i.slug = $2 AND i.kind = $3`,
      [item.brand, item.slug, kind],
    );
    const row = r.rows[0];
    if (!row) {
      result.missing++;
      continue;
    }
    const inserted = await db.query<{ topic_id: number }>(
      `INSERT INTO item_topics (item_id, topic_id)
       SELECT $1, id FROM topics WHERE slug = ANY($2)
       ON CONFLICT DO NOTHING
       RETURNING topic_id`,
      [row.id, topics],
    );
    if (inserted.rows.length) result.added += inserted.rows.length;
    else result.unchanged++;
  }
}

export async function updateAgeBandTopics(db: Db, articles: Article[], quizzes: Quiz[], games: Game[]): Promise<AgeBandSyncResult> {
  const result: AgeBandSyncResult = { added: 0, unchanged: 0, missing: 0 };
  await syncKind(db, 'article', articles.map((a) => ({ brand: a.brand, slug: a.slug, ageBands: a.ageBands })), result);
  // Quizzes and games are slugged by their content id in the items table (import-legacy).
  await syncKind(db, 'quiz', quizzes.map((q) => ({ brand: q.brand, slug: q.id, ageBands: q.ageBands })), result);
  await syncKind(db, 'game', games.map((g) => ({ brand: g.brand, slug: g.id, ageBands: g.ageBands })), result);
  return result;
}
