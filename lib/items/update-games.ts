// Refreshes stored visual-game rows from content/games. The legacy import is insert-only
// (ON CONFLICT DO NOTHING), so a game fix in the content files — the backdrop-ambiguity repairs
// of 18 Nov 2026 (observation-030 & friends) and the neutral memory-game summaries — never
// reaches an already-imported row on its own; this is the deliberate, guarded counterpart, the
// same arrangement as updateHeroImages for article heroes. Only kind = 'game' rows matched by
// world + slug are touched, and only when the stored row actually differs from what the import
// would build today (gameBodyFor / gameSummaryFor / gameAnswerFor in lib/items/import-legacy.ts;
// keep the two in step). Title, summary, body, publish date and status are refreshed together,
// and the answer key with its explanation in item_answers. Nothing else is rewritten.
// Verified by tests/unit/update-games.test.ts.
import type { Db } from '@/lib/db';
import type { Game } from '@/lib/schemas';
import { gameAnswerFor, gameBodyFor, gameSummaryFor } from './import-legacy';

// Key-order-insensitive stringify: jsonb does not preserve key order, so a stored body can come
// back in a different key order than the object built here. (Same helper as update-heroes.ts.)
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export type GameUpdateResult = { updated: number; unchanged: number; missing: number };

export async function updateGameItems(db: Db, games: Game[]): Promise<GameUpdateResult> {
  let updated = 0;
  let unchanged = 0;
  let missing = 0;
  for (const g of games) {
    const r = await db.query<{ id: string; title: string; summary: string; body: unknown; publish_at: Date | string | null; status: string }>(
      `SELECT i.id, i.title, i.summary, i.body, i.publish_at, i.status FROM items i JOIN worlds w ON w.id = i.world_id
       WHERE w.slug = $1 AND i.slug = $2 AND i.kind = 'game'`,
      [g.brand, g.id],
    );
    const row = r.rows[0];
    if (!row) {
      missing++;
      continue;
    }
    const body = gameBodyFor(g);
    const summary = gameSummaryFor(g);
    const status = g.reviewStatus === 'approved' ? 'published' : 'draft';
    const wantDate = status === 'published' ? g.scheduledDate : null;
    const storedDate = row.publish_at ? new Date(row.publish_at).toISOString().slice(0, 10) : null;
    const itemSame =
      row.title === g.title &&
      row.summary === summary &&
      canonical(row.body) === canonical(body) &&
      storedDate === wantDate &&
      row.status === status;

    const a = await db.query<{ answer: unknown; explanation: string }>(
      'SELECT answer, explanation FROM item_answers WHERE item_id = $1',
      [row.id],
    );
    const aRow = a.rows[0];
    const answer = gameAnswerFor(g);
    const answerSame = Boolean(aRow) && canonical(aRow!.answer) === canonical(answer) && aRow!.explanation === g.explanation;

    if (itemSame && answerSame) {
      unchanged++;
      continue;
    }
    if (!itemSame) {
      const publishAt = wantDate ? `${wantDate}T00:00:00Z` : null;
      await db.query(
        'UPDATE items SET title = $1, summary = $2, body = $3::jsonb, publish_at = $4, published_at = $4, status = $5 WHERE id = $6',
        [g.title, summary, JSON.stringify(body), publishAt, status, row.id],
      );
    }
    if (!answerSame) {
      if (aRow) {
        await db.query('UPDATE item_answers SET answer = $1::jsonb, explanation = $2 WHERE item_id = $3', [
          JSON.stringify(answer),
          g.explanation,
          row.id,
        ]);
      } else {
        await db.query('INSERT INTO item_answers (item_id, answer, explanation) VALUES ($1, $2::jsonb, $3)', [
          row.id,
          JSON.stringify(answer),
          g.explanation,
        ]);
      }
    }
    updated++;
  }
  return { updated, unchanged, missing };
}
