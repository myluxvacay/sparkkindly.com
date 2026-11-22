import type { MetadataRoute } from 'next';

const STATIC = ['/', '/quiz/archive/', '/topics/', '/about/', '/privacy/', '/terms/','/editorial-policy/', '/accessibility/', '/contact/'];

// One file holds at most 50,000 URLs; items are capped below that so static pages, worlds and topics always fit
// (SEO audit M4). ponytail: a single file; split into generateSitemaps() chunks with an index when items near the cap.
export const SITEMAP_MAX_ITEMS = 45_000;

// Pages that exist only with their flag on (SEO audit L5).
export function flagPages(on: { comments: boolean; sponsorship: boolean; contributors: boolean }): string[] {
  return [
    ...(on.comments ? ['/community/guidelines/'] : []),
    ...(on.sponsorship ? ['/sponsorship/'] : []),
    ...(on.contributors ? ['/contributors/terms/'] : []),
  ];
}

// Pure: turns what the read layer returned into sitemap entries. It trusts its input, since which items are public is
// decided once, in lib/public/reads.ts. /search/ is deliberately absent (it is noindex).
export function buildSitemap(
  items: { world: string; slug: string; updatedAt: Date }[],
  worlds: string[],
  baseUrl: string,
  topics: string[] = [],
  extra: string[] = [],
): MetadataRoute.Sitemap {
  const at = (path: string, lastModified?: Date) => ({ url: `${baseUrl}${path}`, ...(lastModified && { lastModified }) });
  return [
    ...[...STATIC, ...extra].map((p) => at(p)),
    ...worlds.map((w) => at(`/${w}/`)),
    ...topics.map((t) => at(`/topics/${t}/`)),
    ...items.map((i) => at(`/${i.world}/${i.slug}/`, i.updatedAt)),
  ];
}
