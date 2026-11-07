export const PAGE_SIZE = 12;
const MAX_PAGE = 1000;

// A page number from a query string: anything that is not a positive whole number is page 1, and absurd values are capped
// so the database offset stays small.
export function parsePage(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const n = Number(raw);
  return n < 1 ? 1 : Math.min(n, MAX_PAGE);
}

// The self-referencing canonical of a paginated listing (SEO audit M3): page 1 is the path itself, later pages keep only
// ?page=N, so tracking or other parameters never make a second URL for the same page.
export const pageCanonical = (path: string, page: number): string => (page > 1 ? `${path}?page=${page}` : path);
