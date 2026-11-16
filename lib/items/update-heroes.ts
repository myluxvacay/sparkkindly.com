// Refreshes the stored hero image of already-imported articles from the content files. The legacy import is
// insert-only (ON CONFLICT DO NOTHING), so a hero change in content/articles never reaches existing rows on its
// own; this is the deliberate, guarded counterpart used when article artwork changes (the topic hero set of
// 15 Nov 2026). Only the items.image column is touched, only for kind = 'article', matched by world + slug —
// titles, bodies, status and answers are never rewritten here. The image object is built exactly as the import
// builds it (imageFor in lib/items/import-legacy.ts; keep the two in step).
// Verified by tests/unit/update-heroes.test.ts.
import type { Db } from '@/lib/db';
import type { Article } from '@/lib/schemas';

function imageFor(hero: Article['hero']) {
  const stock = /unsplash/i.test(hero.credit);
  return {
    src: hero.src,
    alt: hero.alt,
    width: hero.width,
    height: hero.height,
    origin: stock ? 'stock' : 'owner-supplied',
    licence: stock ? 'https://unsplash.com/license' : hero.rights,
    credit: hero.credit,
    rights: hero.rights,
  };
}

// Key-order-insensitive stringify: jsonb does not preserve key order, so a stored image can come back in a
// different key order than the object built here.
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

export type HeroUpdateResult = { updated: number; unchanged: number; missing: number };

export async function updateHeroImages(db: Db, articles: Article[]): Promise<HeroUpdateResult> {
  let updated = 0;
  let unchanged = 0;
  let missing = 0;
  for (const a of articles) {
    const image = imageFor(a.hero);
    const r = await db.query<{ id: string; image: unknown }>(
      `SELECT i.id, i.image FROM items i JOIN worlds w ON w.id = i.world_id
       WHERE w.slug = $1 AND i.slug = $2 AND i.kind = 'article'`,
      [a.brand, a.slug],
    );
    const row = r.rows[0];
    if (!row) {
      missing++;
      continue;
    }
    if (canonical(row.image) === canonical(image)) {
      unchanged++;
      continue;
    }
    await db.query('UPDATE items SET image = $1::jsonb WHERE id = $2', [JSON.stringify(image), row.id]);
    updated++;
  }
  return { updated, unchanged, missing };
}
