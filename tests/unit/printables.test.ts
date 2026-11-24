import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGE_BANDS, PRINTABLE_CATEGORIES, printableAgeBand, printableCategory } from '@/lib/printables';

// Library integrity: the 300 delivered printables (scripts/ingest-printables.ts), the one
// in-house sheet added 23 Nov 2026 (paper-aeroplane-classic-dart, Fold & Make — the delivery had
// no aeroplane), the six owner-delivered How Things Work posters (23 Nov 2026, their own
// category) and the 39 QA-passed How Things Work rich-illustration posters (24 Nov 2026 —
// 62 delivered, 41 passed reviewer QA, 2 owner hold-outs) must agree with the taxonomy and
// with the assets on disk — an item whose PDF or preview is missing, or whose tags drift from
// its category, would ship a broken sheet page to a child's table.

const articlesDir = path.join(process.cwd(), 'content/articles');
const printableDocs = fs
  .readdirSync(articlesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(articlesDir, f), 'utf8')))
  .filter((d) => typeof d.id === 'string' && d.id.startsWith('printable-'));

describe('printables taxonomy', () => {
  it('has sixteen categories with unique topics and the two delivered age bands', () => {
    expect(PRINTABLE_CATEGORIES).toHaveLength(16);
    expect(new Set(PRINTABLE_CATEGORIES.map((c) => c.topic)).size).toBe(16);
    expect(AGE_BANDS.map((a) => a.topic)).toEqual(['ages-5-8', 'ages-6-10']);
  });
});

describe('delivered printable library', () => {
  it('has exactly 346 items: twenty per delivered category, the aeroplane in Fold & Make, forty-five How Things Work posters', () => {
    expect(printableDocs).toHaveLength(346);
    const perTopic = new Map<string, number>();
    for (const doc of printableDocs) {
      const topic = PRINTABLE_CATEGORIES.map((c) => c.topic).find((t) => doc.tags.includes(t));
      expect(topic, doc.slug).toBeTruthy();
      perTopic.set(topic!, (perTopic.get(topic!) ?? 0) + 1);
    }
    for (const category of PRINTABLE_CATEGORIES) {
      const expected = category.topic === 'printables-fold-make' ? 21 : category.topic === 'printables-how-things-work' ? 45 : 20;
      expect(perTopic.get(category.topic), category.slug).toBe(expected);
    }
  });

  it('every item is a kids activity tagged printables + one category + one delivered age band', () => {
    const categoryTopics = new Set(PRINTABLE_CATEGORIES.map((c) => c.topic));
    const ageTopics = new Set(AGE_BANDS.map((a) => a.topic));
    for (const doc of printableDocs) {
      expect(doc.brand, doc.slug).toBe('kids');
      expect(doc.contentType, doc.slug).toBe('activity');
      expect(doc.tags, doc.slug).toContain('printables');
      expect(doc.tags.filter((t: string) => categoryTopics.has(t)), doc.slug).toHaveLength(1);
      expect(doc.tags.filter((t: string) => ageTopics.has(t)), doc.slug).toHaveLength(1);
      // The Kids five fields ride along on every sheet page's grown-ups panel.
      for (const field of ['ageGuidance', 'materials', 'supervision', 'safetyNotes', 'screenFreeExtension']) {
        expect(doc[field], `${doc.slug}:${field}`).toBeTruthy();
      }
    }
  });

  it('every item has its delivered PDF and rendered preview on disk, and the hero points at the preview', () => {
    for (const doc of printableDocs) {
      expect(doc.hero.src, doc.slug).toBe(`/images/printable-${doc.slug}.webp`);
      expect(fs.existsSync(path.join(process.cwd(), 'public', doc.hero.src)), doc.slug).toBe(true);
      const pdf = path.join(process.cwd(), 'public/printable-pdfs', `${doc.slug}.pdf`);
      expect(fs.existsSync(pdf), doc.slug).toBe(true);
      // A real PDF, not an error page saved by the download.
      expect(fs.readFileSync(pdf).subarray(0, 5).toString('latin1'), doc.slug).toBe('%PDF-');
    }
  });

  it('slugs are unique and category/age helpers resolve from topics', () => {
    expect(new Set(printableDocs.map((d) => d.slug)).size).toBe(346);
    for (const doc of printableDocs.slice(0, 25)) {
      const item = { topics: doc.tags as string[] };
      expect(printableCategory(item)?.topic, doc.slug).toBe(doc.tags.find((t: string) => t.startsWith('printables-') && t !== 'printables'));
      expect(printableAgeBand(item)?.topic, doc.slug).toBe(doc.tags.find((t: string) => t.startsWith('ages-')));
    }
  });
});
