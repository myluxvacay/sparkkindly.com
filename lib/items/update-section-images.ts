// Refreshes the stored section images of already-imported articles from the content files. The legacy import
// is insert-only (ON CONFLICT DO NOTHING), so a section image added to content/articles (the step strip on a
// "How it works" section, 21 Nov 2026) never reaches existing rows on its own; this is the deliberate, guarded
// counterpart, in the same shape as updateHeroImages. Only the `image` and `imagePanels` keys of body sections
// are touched (imagePanels is the strip's mobile panel arrangement, added 21 Nov 2026), only for
// kind = 'article', matched by world + slug; sections are matched by heading, and an article whose stored
// headings do not cover the file's imaged sections is skipped untouched rather than rewritten on a guess.
// Verified by tests/unit/update-section-images.test.ts.
import type { Db } from '@/lib/db';
import type { Article } from '@/lib/schemas';

type Section = { heading: string; image?: unknown; imagePanels?: unknown; [key: string]: unknown };
type StoredBody = { sections?: Section[]; [key: string]: unknown };

// Key-order-insensitive stringify: jsonb does not preserve key order, so a stored section can come back in a
// different key order than the object built here. (Same helper as update-heroes.ts.)
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

export type SectionImageUpdateResult = { updated: number; unchanged: number; missing: number; skipped: number };

export async function updateSectionImages(db: Db, articles: Article[]): Promise<SectionImageUpdateResult> {
  let updated = 0;
  let unchanged = 0;
  let missing = 0;
  let skipped = 0;
  for (const a of articles) {
    const imaged = a.body.filter((s) => s.image || s.imagePanels);
    const r = await db.query<{ id: string; body: StoredBody }>(
      `SELECT i.id, i.body FROM items i JOIN worlds w ON w.id = i.world_id
       WHERE w.slug = $1 AND i.slug = $2 AND i.kind = 'article'`,
      [a.brand, a.slug],
    );
    const row = r.rows[0];
    if (!row) {
      missing++;
      continue;
    }
    const stored = row.body;
    if (!stored || !Array.isArray(stored.sections)) {
      // Nothing structured to sync into; only articles that carry a strip in the file are a concern.
      if (imaged.length) skipped++;
      else unchanged++;
      continue;
    }
    if (
      !imaged.length &&
      !stored.sections.some((s) => s && typeof s === 'object' && ('image' in s || 'imagePanels' in s))
    ) {
      unchanged++;
      continue;
    }
    // Match by heading: every file section's image state (present or absent) is applied to the stored section
    // with the same heading. If an imaged file section has no stored namesake, leave the article untouched.
    const byHeading = new Map<string, Section>();
    for (const s of stored.sections) if (s && typeof s.heading === 'string') byHeading.set(s.heading, s);
    if (imaged.some((s) => !byHeading.has(s.heading))) {
      skipped++;
      continue;
    }
    let changed = false;
    const sections = stored.sections.map((s) => {
      if (!s || typeof s.heading !== 'string') return s;
      const file = a.body.find((f) => f.heading === s.heading);
      if (!file) return s;
      const next: Section = { ...s };
      if (file.image) {
        if (canonical(next.image) !== canonical(file.image)) {
          next.image = file.image;
          changed = true;
        }
      } else if ('image' in next) {
        delete next.image;
        changed = true;
      }
      if (file.imagePanels) {
        if (canonical(next.imagePanels) !== canonical(file.imagePanels)) {
          next.imagePanels = file.imagePanels;
          changed = true;
        }
      } else if ('imagePanels' in next) {
        delete next.imagePanels;
        changed = true;
      }
      return next;
    });
    if (!changed) {
      unchanged++;
      continue;
    }
    await db.query('UPDATE items SET body = $1::jsonb WHERE id = $2', [
      JSON.stringify({ ...stored, sections }),
      row.id,
    ]);
    updated++;
  }
  return { updated, unchanged, missing, skipped };
}
