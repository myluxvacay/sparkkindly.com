export const PAGE_SIZE = 12;
const MAX_PAGE = 1000;

// A page number from a query string: anything that is not a positive whole number is page 1, and absurd values are capped
// so the database offset stays small.
export function parsePage(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const n = Number(raw);
  return n < 1 ? 1 : Math.min(n, MAX_PAGE);
}
