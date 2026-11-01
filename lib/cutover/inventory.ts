// The URL inventory for the cut-over: every URL the static mock-up served, and what the new app must answer for it.
// Pure, so it is unit-tested; scripts/url-inventory.ts feeds it the content files and fetches each entry.
export type Entry = { path: string; status: 200 | 308; location?: string };

const WORLDS = ['play', 'discover', 'together', 'grow', 'kids'];
const STATIC = ['/', '/quiz/', '/quiz/archive/', '/about/', '/editorial-policy/', '/privacy/', '/accessibility/', '/contact/'];
// Pages the new app adds. They are checked too, but they are not part of "the old site still works".
const NEW_PAGES = ['/terms/', '/search/'];

export function buildInventory(articles: { brand: string; slug: string }[], quizzes: { id: string; brand: string }[]): Entry[] {
  const ok = (path: string): Entry => ({ path, status: 200 });
  return [
    ...STATIC.map(ok),
    ...NEW_PAGES.map(ok),
    ok('/robots.txt'),
    ok('/sitemap.xml'),
    ...WORLDS.map((w) => ok(`/${w}/`)),
    ...articles.map((a) => ok(`/${a.brand}/${a.slug}/`)),
    // The mock-up served each quiz at /quiz/<id>/; the new site answers it at the item's own URL.
    ...quizzes.map((q): Entry => ({ path: `/quiz/${q.id}/`, status: 308, location: `/${q.brand}/${q.id}/` })),
  ];
}

// null when the response is what the inventory expects, otherwise a one-line reason.
export function checkEntry(entry: Entry, got: { status: number; location: string | null }): string | null {
  if (got.status !== entry.status) return `${entry.path}: expected ${entry.status}, got ${got.status}`;
  if (entry.status === 308) {
    const target = got.location ? got.location.replace(/^https?:\/\/[^/]+/, '') : null;
    if (target !== entry.location) return `${entry.path}: expected redirect to ${entry.location}, got ${target}`;
  }
  return null;
}
