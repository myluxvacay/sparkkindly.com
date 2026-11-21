// "Keep reading" selection (owner request, 20 Nov 2026): the reading counterpart of the keep-playing
// flow (lib/play/keep-playing.ts). When a reader finishes an article, the panel offers the next
// similar article — same series first, then the same track, then shared topics, then the same reading
// band — plus easier / same level / harder choices across the three reading bands, mirroring the
// quiz flow's three difficulty buttons. This module is the pure logic: scoring, band resolution and
// model building, shared by the server panel (which builds the candidate pool from the same
// scope-filtered read the archive uses) and the reading island (which re-picks against the device's
// read list at tap time). Everything is deterministic — no randomness at render time.

// The reading bands are topic slugs (the Poster Series pilot tags every article with exactly one;
// migration 043 makes them real topics). Their order is the reading ladder, gentlest first — the
// article counterpart of DIFFICULTY_ORDER.
export type Band = 'pre-k' | 'grades-k-2' | 'grades-3-5';
export const BAND_ORDER: Band[] = ['pre-k', 'grades-k-2', 'grades-3-5'];
export const BAND_LABEL: Record<Band, string> = { 'pre-k': 'Pre-K', 'grades-k-2': 'Grades K–2', 'grades-3-5': 'Grades 3–5' };

// The series structure the pilot stamps on its articles (also topic slugs since migration 043): the
// collection every reading item belongs to, the series itself, and the five tracks inside it.
export const COLLECTION_TOPIC = 'reading';
export const SERIES_TOPIC = 'poster-series';
export const TRACK_TOPICS = ['grammar', 'phonics', 'vocabulary', 'kindness', 'explainers'] as const;
export type Track = (typeof TRACK_TOPICS)[number];
export const TRACK_LABEL: Record<Track, string> = {
  grammar: 'Grammar',
  phonics: 'Phonics',
  vocabulary: 'Vocabulary',
  kindness: 'Kindness & safety',
  explainers: 'Explainers',
};

const STRUCTURAL: ReadonlySet<string> = new Set([COLLECTION_TOPIC, SERIES_TOPIC, ...TRACK_TOPICS, ...BAND_ORDER]);

export const bandOf = (topics: readonly string[]): Band | null => BAND_ORDER.find((b) => topics.includes(b)) ?? null;
export const trackOf = (topics: readonly string[]): Track | null =>
  TRACK_TOPICS.find((t) => topics.includes(t)) ?? null;

// How alike two articles are, from the metadata both actually carry (their topic slugs). The series
// is the strongest bond — a poster-set reader is mid-collection — then the same track, then the same
// band, then shared ordinary topics, then the shared reading collection. Ordinary library articles
// carry none of the structural tags, so for them the shared-topics and same-band terms do the work,
// and two articles sharing nothing score 0 (the pool order then falls back to newest first).
export function scoreCandidate(currentTopics: readonly string[], candidateTopics: readonly string[]): number {
  const shared = candidateTopics.filter((t) => currentTopics.includes(t));
  let score = 0;
  if (shared.includes(SERIES_TOPIC)) score += 100;
  const track = trackOf(currentTopics);
  if (track && track === trackOf(candidateTopics)) score += 40;
  const band = bandOf(currentTopics);
  if (band && band === bandOf(candidateTopics)) score += 25;
  if (shared.includes(COLLECTION_TOPIC)) score += 10;
  for (const t of shared) if (!STRUCTURAL.has(t)) score += 10;
  return score;
}

// The one-line "why this one" under the recommended article's title. Slugs become plain words
// ('earth-science' → 'Earth science'); the structural pieces use their proper labels.
export function reasonFor(currentTopics: readonly string[], candidate: { topics: readonly string[] }): string {
  const shared = candidate.topics.filter((t) => currentTopics.includes(t));
  const track = trackOf(currentTopics);
  if (shared.includes(SERIES_TOPIC) && track && track === trackOf(candidate.topics)) {
    return `More ${TRACK_LABEL[track]} in the Poster Series`;
  }
  if (track && track === trackOf(candidate.topics)) return `More ${TRACK_LABEL[track]} to read`;
  if (shared.includes(SERIES_TOPIC)) return 'More from the Poster Series';
  const ordinary = shared.find((t) => !STRUCTURAL.has(t));
  if (ordinary) return `More about ${ordinary.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase())}`;
  const band = bandOf(currentTopics);
  if (band && band === bandOf(candidate.topics)) return `${BAND_LABEL[band]} reading`;
  if (shared.includes(COLLECTION_TOPIC)) return 'More reading to explore';
  return 'Another article to read';
}

export type ReadCandidateInput = {
  id: string;
  world: string;
  slug: string;
  title: string;
  summary: string;
  image: { src?: string; alt: string } | null;
  topics: string[];
  publishedAt: string; // ISO timestamp; the stable tiebreak under equal scores
};

export type ReadCandidate = {
  id: string;
  href: string;
  title: string;
  summary: string;
  image: { src: string; alt: string } | null;
  topics: string[];
  band: Band | null;
  score: number;
};

export type ReadDirection = 'easier' | 'same' | 'harder';
export type ReadOption = { band: Band; skipped: boolean; candidates: ReadCandidate[]; total: number } | null;

export type ReadNextModel = {
  currentId: string;
  currentTopics: string[];
  currentBand: Band | null;
  /**
   * Whether the on-device read list may be used at all on this surface. It is off for Kids-audience
   * articles: the site's child-safety rule is that those journeys store nothing in the browser (the
   * same carve-out the keep-playing flow applies). There the buttons and the card simply follow the
   * server's candidates, and no browser storage is read or written.
   */
  trackRead: boolean;
  /** The recommended next article (the first of the `next` shelf), or null when nothing else exists. */
  primary: ReadCandidate | null;
  primaryReason: string;
  /** The ranked shelf the primary came from; the island re-picks its first unread entry at tap time. */
  next: ReadCandidate[];
  nextTotal: number;
  /** Easier / same / harder across the band ladder; null when the current article carries no band. */
  options: Record<ReadDirection, ReadOption> | null;
  /** The way back to the shelf this article belongs to (the reading collection, a topic, the world). */
  collection: { href: string; label: string };
};

// How many candidates per shelf ride in the page. The island can only prove a shelf exhausted when
// it holds the shelf's whole pool, so the cap sits well above today's per-band counts; `total`
// always carries the pool's true size so a truncated pool is never mistaken for a finished one.
export const MAX_READ_CANDIDATES = 50;

type BandPools = Record<Band, ReadCandidate[]>;

// Rotate a shelf by a seed derived from the current article, so different articles offer a different
// first candidate without any randomness at render time (the panel is server-rendered and must stay
// deterministic). Same hash rotation as keep-playing's rotateCandidates.
export function rotateReadCandidates(candidates: ReadCandidate[], seed: string): ReadCandidate[] {
  if (candidates.length < 2) return candidates;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const offset = hash % candidates.length;
  return [...candidates.slice(offset), ...candidates.slice(0, offset)];
}

export type ResolvedBand = { band: Band; skipped: boolean };

// Where a direction actually lands on the band ladder — the band counterpart of keep-playing's
// resolveDirection, with the same promises: `skipped` is true when the immediate target band has no
// candidates and the nearest populated band beyond it (in the same direction) is used instead, and
// the result is null when nothing is populated in that direction (the edge of the ladder, or an
// empty pool) so the UI disables the button with a friendly note rather than erroring or looping.
export function resolveBandDirection(
  current: Band,
  direction: ReadDirection,
  pools: BandPools,
): ResolvedBand | null {
  const idx = BAND_ORDER.indexOf(current);
  const populated = (band: Band) => pools[band].length > 0;
  if (direction === 'same') {
    if (populated(current)) return { band: current, skipped: false };
    // The reader's own band is empty in the pool: nearest populated band, gentler side first.
    for (let d = 1; d < BAND_ORDER.length; d++) {
      const down = BAND_ORDER[idx - d];
      if (down && populated(down)) return { band: down, skipped: true };
      const up = BAND_ORDER[idx + d];
      if (up && populated(up)) return { band: up, skipped: true };
    }
    return null;
  }
  const step = direction === 'easier' ? -1 : 1;
  for (let i = idx + step; i >= 0 && i < BAND_ORDER.length; i += step) {
    if (populated(BAND_ORDER[i])) return { band: BAND_ORDER[i], skipped: Math.abs(i - idx) > 1 };
  }
  return null;
}

// Build the serialisable model the server panel hands to the markup. `items` is the caller's pool —
// the visible articles of the current article's world (the page falls back to the whole library when
// a world holds nothing else) — and never includes the current article in the result. Ranking is by
// similarity score, newest first under a tie, so the model is fully deterministic for a given pool.
export function buildReadNextModel(
  current: { id: string; topics: readonly string[] },
  items: ReadCandidateInput[],
  extra: { trackRead?: boolean; collection: { href: string; label: string } },
): ReadNextModel {
  const scored = items
    .filter((i) => i.id !== current.id)
    .map((i) => ({ i, score: scoreCandidate(current.topics, i.topics) }));
  // ISO timestamps order chronologically as strings; the slug settles any remaining tie, so the
  // ranking is fully deterministic for a given pool.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.i.publishedAt < b.i.publishedAt ? 1 : a.i.publishedAt > b.i.publishedAt ? -1 : 0) ||
      (a.i.slug < b.i.slug ? -1 : a.i.slug > b.i.slug ? 1 : 0),
  );
  const ranked: ReadCandidate[] = scored.map(({ i, score }) => ({
    id: i.id,
    href: `/${i.world}/${i.slug}/`,
    title: i.title,
    summary: i.summary,
    image: i.image?.src ? { src: i.image.src, alt: i.image.alt } : null,
    topics: i.topics,
    band: bandOf(i.topics),
    score,
  }));

  const currentBand = bandOf(current.topics);
  let options: Record<ReadDirection, ReadOption> | null = null;
  let primaryPool = ranked;
  if (currentBand) {
    const pools = { 'pre-k': [], 'grades-k-2': [], 'grades-3-5': [] } as BandPools;
    for (const cand of ranked) if (cand.band) pools[cand.band].push(cand);
    for (const band of BAND_ORDER) pools[band] = rotateReadCandidates(pools[band], `${current.id}:${band}`);
    options = { easier: null, same: null, harder: null };
    for (const direction of ['easier', 'same', 'harder'] as ReadDirection[]) {
      const resolved = resolveBandDirection(currentBand, direction, pools);
      options[direction] = resolved
        ? {
            band: resolved.band,
            skipped: resolved.skipped,
            candidates: pools[resolved.band].slice(0, MAX_READ_CANDIDATES),
            total: pools[resolved.band].length,
          }
        : null;
    }
    // The primary recommendation is the top of the resolved same-level shelf — the closest thing to
    // "the next article like this one" — falling back to the best-ranked article overall when the
    // reader's own ladder offers nothing.
    const same = options.same;
    if (same && same.candidates.length) primaryPool = pools[same.band];
  }

  const primary = primaryPool[0] ?? null;
  return {
    currentId: current.id,
    currentTopics: [...current.topics],
    currentBand,
    trackRead: extra.trackRead ?? true,
    primary,
    primaryReason: primary ? reasonFor(current.topics, primary) : '',
    next: primaryPool.slice(0, MAX_READ_CANDIDATES),
    nextTotal: primaryPool.length,
    options,
    collection: extra.collection,
  };
}
