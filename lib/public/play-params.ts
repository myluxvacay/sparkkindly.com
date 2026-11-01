// Reads a play page's query string. Next hands over a record of string | string[]; the first value of a repeated key wins.
export type SearchParams = Record<string, string | string[] | undefined>;

export function toParams(sp: SearchParams): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const first = Array.isArray(v) ? v[0] : v;
    if (first !== undefined) p.set(k, first);
  }
  return p;
}

// True when the visitor submitted a response (as opposed to just opening the page or asking for another clue).
export const hasResponse = (p: URLSearchParams): boolean => p.has('r') || [...p.keys()].some((k) => k.startsWith('pos-'));

// How many clues to show: `clues=n`, clamped to 1..total; anything else shows one.
export function clueCount(p: URLSearchParams, total: number): number {
  const n = Number(p.get('clues'));
  return Number.isInteger(n) ? Math.min(Math.max(n, 1), Math.max(total, 1)) : 1;
}
