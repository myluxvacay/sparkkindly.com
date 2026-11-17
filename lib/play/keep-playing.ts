import type { Difficulty } from '@/lib/public/body';

// "Keep playing" difficulty flow (owner request, 17 Nov 2026): after a quiz answer, the player is offered
// an easier, a same-level or a harder quiz instead of being dropped into the archive. This module is the
// pure logic — level resolution, candidate picking against the session's played set, and flick detection —
// shared by the server panel (which builds the candidate pools from the same scope-filtered read the
// archive uses) and the play island (which applies the session exclusions and the touch gestures).

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export type KeepPlayDirection = 'easier' | 'same' | 'harder';
export type QuizCandidate = { id: string; href: string };
export type CandidatePools = Record<Difficulty, QuizCandidate[]>;

export const emptyPools = (): CandidatePools => ({ easy: [], medium: [], hard: [] });

// Group visible quizzes into per-level candidate pools, leaving out the quiz just played. Order is the
// caller's (the server rotates before capping); quizzes without a readable difficulty cannot be offered
// by level and are skipped.
export function poolQuizzes(
  items: { id: string; world: string; slug: string; difficulty?: Difficulty }[],
  excludeId: string,
): CandidatePools {
  const pools = emptyPools();
  for (const item of items) {
    if (item.id === excludeId || !item.difficulty) continue;
    pools[item.difficulty].push({ id: item.id, href: `/${item.world}/${item.slug}/` });
  }
  return pools;
}

export type ResolvedDirection = { level: Difficulty; skipped: boolean };

// Where a direction actually lands. `skipped` is true when the immediate target level has no quizzes and
// the nearest populated level beyond it (in the same direction) is used instead — the UI says so, so a
// player is never silently handed a different jump than the button promised. Returns null when nothing
// is populated in that direction (the edge of the scale, or an empty pool): the UI disables the button
// with a friendly note rather than erroring or looping back.
export function resolveDirection(
  current: Difficulty,
  direction: KeepPlayDirection,
  pools: CandidatePools,
): ResolvedDirection | null {
  const idx = DIFFICULTY_ORDER.indexOf(current);
  const populated = (level: Difficulty) => pools[level].length > 0;
  if (direction === 'same') {
    if (populated(current)) return { level: current, skipped: false };
    // The player's own level is exhausted in the pool: nearest populated level, gentler side first.
    for (let d = 1; d < DIFFICULTY_ORDER.length; d++) {
      const down = DIFFICULTY_ORDER[idx - d];
      if (down && populated(down)) return { level: down, skipped: true };
      const up = DIFFICULTY_ORDER[idx + d];
      if (up && populated(up)) return { level: up, skipped: true };
    }
    return null;
  }
  const step = direction === 'easier' ? -1 : 1;
  for (let i = idx + step; i >= 0 && i < DIFFICULTY_ORDER.length; i += step) {
    if (populated(DIFFICULTY_ORDER[i])) return { level: DIFFICULTY_ORDER[i], skipped: Math.abs(i - idx) > 1 };
  }
  return null;
}

// Rotate a level's candidates by a seed derived from the current quiz, so different quizzes offer a
// different first candidate without any randomness at render time (the panel is server-rendered and
// must stay deterministic). The session exclusion in the island provides the rest of the variety.
export function rotateCandidates(candidates: QuizCandidate[], seed: string): QuizCandidate[] {
  if (candidates.length < 2) return candidates;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const offset = hash % candidates.length;
  return [...candidates.slice(offset), ...candidates.slice(0, offset)];
}

// The next quiz to serve from one level's candidates: the first the session has not played. When every
// candidate has been played, `exhausted` is set and the first candidate comes back — the caller resets
// that level's played set, so a keen player cycles the level instead of hitting a dead end.
export function pickCandidate(
  candidates: QuizCandidate[],
  playedIds: ReadonlySet<string>,
): { candidate: QuizCandidate; exhausted: boolean } | null {
  if (!candidates.length) return null;
  const fresh = candidates.find((c) => !playedIds.has(c.id));
  return fresh ? { candidate: fresh, exhausted: false } : { candidate: candidates[0], exhausted: true };
}

// A deliberate flick on the result panel: fast, mostly vertical, and long enough to never be a scroll.
// Ordinary scrolling is never hijacked — a slow drag (a scroll in progress) or a short drift returns
// null, and the touch handlers never preventDefault, so the page scrolls exactly as before.
export function detectFlick(input: { dx: number; dy: number; durationMs: number }): 'up' | 'down' | null {
  const { dx, dy, durationMs } = input;
  if (durationMs > 500) return null;
  if (Math.abs(dy) < 56) return null;
  if (Math.abs(dy) < Math.abs(dx) * 1.6) return null;
  return dy < 0 ? 'up' : 'down';
}

// How many candidates per level ride in the page. The island can only prove a level exhausted when it
// holds the level's whole pool, so the cap sits well above today's visible per-level counts; `total`
// always carries the pool's true size so a truncated pool is never mistaken for a finished one.
export const MAX_CANDIDATES = 50;

// The serialisable model the server panel hands to the markup: per direction, where it lands and the
// candidates to pick from (the island re-picks against the merged seen-set at tap time; the first
// candidate is the plain-link target, so the buttons work with no JavaScript at all). For a signed-in
// player, `accountSeen` carries the ids among these candidates that their saved-answer history already
// covers — the island merges it with the device's own seen memory (lib/play/seen-quizzes).
export type KeepPlayOption = {
  level: Difficulty;
  skipped: boolean;
  candidates: QuizCandidate[];
  total: number;
} | null;
export type KeepPlayModel = {
  currentId: string;
  currentLevel: Difficulty;
  signedIn: boolean;
  accountSeen: string[];
  options: Record<KeepPlayDirection, KeepPlayOption>;
};

export function buildModel(
  currentId: string,
  currentLevel: Difficulty,
  pools: CandidatePools,
  extra: { accountSeen?: string[]; signedIn?: boolean } = {},
): KeepPlayModel {
  const options = {} as Record<KeepPlayDirection, KeepPlayOption>;
  for (const direction of ['easier', 'same', 'harder'] as KeepPlayDirection[]) {
    const resolved = resolveDirection(currentLevel, direction, pools);
    options[direction] = resolved
      ? {
          level: resolved.level,
          skipped: resolved.skipped,
          candidates: pools[resolved.level].slice(0, MAX_CANDIDATES),
          total: pools[resolved.level].length,
        }
      : null;
  }
  return {
    currentId,
    currentLevel,
    signedIn: extra.signedIn ?? false,
    accountSeen: extra.accountSeen ?? [],
    options,
  };
}
