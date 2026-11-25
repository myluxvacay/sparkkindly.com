// Age bands (owner decisions, 24 Nov 2026): the site NEVER asks a visitor's exact age or
// birthdate. A visitor may pick an age band; the band is retained in their browser until they
// change it, and every content item carries the band(s) it suits so serving can lead with
// age-appropriate items. Age-appropriateness is NOT difficulty: it is topic familiarity,
// vocabulary/reading level and concept abstractness (a memory game can suit ages 3–5 even when
// it is challenging; a question about mercury the metal never suits ages 3–5).
//
// Canonical bands: '3-5', '6-8', '9-12' are child bands; 'family' means all-ages / grown-ups —
// it is the absence of a child band, never a stored topic. In the database the child bands are
// topics (ages-3-5, ages-6-8, ages-9-12), linked from each item's `ageBands` content field by
// the legacy import and the guarded sync in lib/items/update-age-bands.ts.

export const AGE_BANDS = ['3-5', '6-8', '9-12', 'family'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export type ChildBand = Exclude<AgeBand, 'family'>;
export const CHILD_BANDS: ChildBand[] = ['3-5', '6-8', '9-12'];

export const BAND_LABEL: Record<AgeBand, string> = {
  '3-5': 'Ages 3–5',
  '6-8': 'Ages 6–8',
  '9-12': 'Ages 9–12',
  family: 'Grown-ups & family',
};

// The chip text on cards and item pages ("Ages 6–8"); family items carry no chip.
export const bandChipLabel = (bands: readonly AgeBand[]): string | null => {
  const child = CHILD_BANDS.filter((b) => bands.includes(b));
  if (!child.length) return null;
  if (child.length === 3) return 'Ages 3–12';
  return child.map((b) => BAND_LABEL[b]).join(' & ');
};

export const bandTopic = (band: ChildBand): string => `ages-${band}`;

// The printables library arrived with two legacy age topics (migration 045). They are unified
// into the canonical bands here — never duplicated: ages-5-8 spans the 3-5 and 6-8 bands,
// ages-6-10 spans 6-8 and 9-12.
export const LEGACY_BAND_TOPICS: Record<string, ChildBand[]> = {
  'ages-5-8': ['3-5', '6-8'],
  'ages-6-10': ['6-8', '9-12'],
};

const TOPIC_TO_BANDS: Record<string, AgeBand[]> = {
  'ages-3-5': ['3-5'],
  'ages-6-8': ['6-8'],
  'ages-9-12': ['9-12'],
  ...LEGACY_BAND_TOPICS,
};

// The bands an item carries, from its topic slugs (the serving representation). An item with
// no child-band topic is for everyone: ['family'].
export function bandsFromTopics(topics: readonly string[]): AgeBand[] {
  const found = new Set<AgeBand>();
  for (const t of topics) for (const b of TOPIC_TO_BANDS[t] ?? []) found.add(b);
  const ordered = AGE_BANDS.filter((b) => found.has(b));
  return ordered.length ? ordered : ['family'];
}

export const isAgeBand = (v: unknown): v is AgeBand =>
  typeof v === 'string' && (AGE_BANDS as readonly string[]).includes(v);

// Map an explicit age range (from ageGuidance text like "Ages 6–9" or a description's
// "for ages 5–8") onto the canonical bands it overlaps. A range that reaches past 12 or
// starts below 3 still only maps onto the child bands it touches; a range entirely above
// the child bands (13+) maps to family.
export function bandsForAgeRange(min: number, max: number): AgeBand[] {
  const spans: [ChildBand, number, number][] = [
    ['3-5', 3, 5],
    ['6-8', 6, 8],
    ['9-12', 9, 12],
  ];
  const hit = spans.filter(([, lo, hi]) => min <= hi && max >= lo).map(([b]) => b);
  return hit.length ? hit : ['family'];
}

export function parseAgeRange(text: string): { min: number; max: number } | null {
  const m = text.match(/ages?\s*(\d{1,2})\s*[–—-]\s*(\d{1,2})/i) ?? text.match(/(\d{1,2})\s*[–—-]\s*(\d{1,2})\s*(?:years?|yrs?)/i);
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  return min >= 0 && max >= min && max <= 18 ? { min, max } : null;
}

// Does an item with these bands suit a visitor exploring as `band`? 'family' items suit
// everyone; a child band suits items carrying that band (or family items).
export function bandMatches(itemBands: readonly AgeBand[], band: AgeBand): boolean {
  if (band === 'family') return true;
  return itemBands.includes(band) || itemBands.includes('family');
}

// The topic slugs an item's ageBands field links to (child bands only; 'family' links none).
export const bandTopicsFor = (bands: readonly AgeBand[] | undefined): string[] =>
  CHILD_BANDS.filter((b) => bands?.includes(b)).map(bandTopic);
