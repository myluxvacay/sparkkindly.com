import type { MetadataRoute } from 'next';

const STATIC = ['/', '/quiz/archive/', '/about/', '/privacy/', '/terms/','/editorial-policy/', '/accessibility/', '/contact/'];

// Pure: turns what the read layer returned into sitemap entries. It trusts its input, since which items are public is
// decided once, in lib/public/reads.ts. /search/ is deliberately absent (it is noindex).
export function buildSitemap(
  items: { world: string; slug: string; updatedAt: Date }[],
  worlds: string[],
  baseUrl: string,
  topics: string[] = [],
): MetadataRoute.Sitemap {
  const at = (path: string, lastModified?: Date) => ({ url: `${baseUrl}${path}`, ...(lastModified && { lastModified }) });
  return [
    ...STATIC.map((p) => at(p)),
    ...worlds.map((w) => at(`/${w}/`)),
    ...topics.map((t) => at(`/topics/${t}/`)),
    ...items.map((i) => at(`/${i.world}/${i.slug}/`, i.updatedAt)),
  ];
}
