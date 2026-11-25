// @vitest-environment node
// Age bands (24 Nov 2026): the canonical band mapping in lib/age-bands.ts — topics to bands
// (including the legacy printables topics), age ranges to bands, chip labels and matching.
import { describe, it, expect } from 'vitest';
import {
  AGE_BANDS,
  BAND_LABEL,
  bandChipLabel,
  bandMatches,
  bandTopicsFor,
  bandsForAgeRange,
  bandsFromTopics,
  parseAgeRange,
} from '@/lib/age-bands';

describe('bandsFromTopics', () => {
  it('maps each canonical band topic to its band, in canonical order', () => {
    expect(bandsFromTopics(['ages-9-12', 'ages-3-5'])).toEqual(['3-5', '9-12']);
    expect(bandsFromTopics(['ages-6-8'])).toEqual(['6-8']);
    expect(bandsFromTopics(['space', 'ages-6-8', 'curiosity'])).toEqual(['6-8']);
  });

  it('unifies the legacy printables topics across the bands they span', () => {
    expect(bandsFromTopics(['ages-5-8'])).toEqual(['3-5', '6-8']);
    expect(bandsFromTopics(['ages-6-10'])).toEqual(['6-8', '9-12']);
    expect(bandsFromTopics(['ages-5-8', 'ages-6-10'])).toEqual(['3-5', '6-8', '9-12']);
    expect(bandsFromTopics(['ages-5-8', 'ages-9-12'])).toEqual(['3-5', '6-8', '9-12']);
  });

  it('defaults to family when no child band topic is present', () => {
    expect(bandsFromTopics([])).toEqual(['family']);
    expect(bandsFromTopics(['space', 'kindness'])).toEqual(['family']);
  });

  it('de-duplicates repeated topics', () => {
    expect(bandsFromTopics(['ages-3-5', 'ages-3-5', 'ages-5-8'])).toEqual(['3-5', '6-8']);
  });
});

describe('bandsForAgeRange', () => {
  it('maps a range onto every band it overlaps', () => {
    expect(bandsForAgeRange(3, 5)).toEqual(['3-5']);
    expect(bandsForAgeRange(5, 8)).toEqual(['3-5', '6-8']);
    expect(bandsForAgeRange(6, 10)).toEqual(['6-8', '9-12']);
    expect(bandsForAgeRange(4, 12)).toEqual(['3-5', '6-8', '9-12']);
    expect(bandsForAgeRange(9, 9)).toEqual(['9-12']);
  });

  it('clamps ranges that reach past the child bands to the bands they touch', () => {
    expect(bandsForAgeRange(2, 4)).toEqual(['3-5']);
    expect(bandsForAgeRange(11, 16)).toEqual(['9-12']);
  });

  it('maps a range entirely above the child bands to family', () => {
    expect(bandsForAgeRange(13, 18)).toEqual(['family']);
  });
});

describe('parseAgeRange', () => {
  it('parses "Ages X–Y" and "X–Y years" forms', () => {
    expect(parseAgeRange('Ages 6–9')).toEqual({ min: 6, max: 9 });
    expect(parseAgeRange('for ages 5-8 with an adult')).toEqual({ min: 5, max: 8 });
    expect(parseAgeRange('Suitable for 3—5 years')).toEqual({ min: 3, max: 5 });
  });

  it('returns null when there is no sane range', () => {
    expect(parseAgeRange('fun for everyone')).toBeNull();
    expect(parseAgeRange('Ages 9–6')).toBeNull();
    expect(parseAgeRange('Ages 3–25')).toBeNull();
  });

  it('round-trips through bandsForAgeRange', () => {
    const r = parseAgeRange('Ages 5–8');
    expect(r && bandsForAgeRange(r.min, r.max)).toEqual(['3-5', '6-8']);
  });
});

describe('bandChipLabel', () => {
  it('labels child bands and joins several', () => {
    expect(bandChipLabel(['6-8'])).toBe('Ages 6–8');
    expect(bandChipLabel(['3-5', '9-12'])).toBe('Ages 3–5 & Ages 9–12');
  });

  it('collapses all three child bands to Ages 3–12', () => {
    expect(bandChipLabel(['3-5', '6-8', '9-12'])).toBe('Ages 3–12');
  });

  it('carries no chip for family or empty bands', () => {
    expect(bandChipLabel(['family'])).toBeNull();
    expect(bandChipLabel([])).toBeNull();
  });
});

describe('bandMatches', () => {
  it('a child band matches items carrying it, and family items suit everyone', () => {
    expect(bandMatches(['6-8'], '6-8')).toBe(true);
    expect(bandMatches(['3-5', '6-8'], '6-8')).toBe(true);
    expect(bandMatches(['family'], '3-5')).toBe(true);
    expect(bandMatches(['3-5'], '9-12')).toBe(false);
  });

  it('the family band matches everything (lead-with, never hide)', () => {
    expect(bandMatches(['3-5'], 'family')).toBe(true);
    expect(bandMatches(['family'], 'family')).toBe(true);
  });
});

describe('bandTopicsFor', () => {
  it('links child bands to their topics only; family links none', () => {
    expect(bandTopicsFor(['3-5', '9-12'])).toEqual(['ages-3-5', 'ages-9-12']);
    expect(bandTopicsFor(['family'])).toEqual([]);
    expect(bandTopicsFor([])).toEqual([]);
    expect(bandTopicsFor(undefined)).toEqual([]);
  });
});

describe('the canonical list', () => {
  it('is exactly the four bands, each labelled', () => {
    expect(AGE_BANDS).toEqual(['3-5', '6-8', '9-12', 'family']);
    for (const b of AGE_BANDS) expect(BAND_LABEL[b]).toBeTruthy();
  });
});
