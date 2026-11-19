import type { MetadataRoute } from 'next';
import { commentsEnabled, contributorsEnabled, promosEnabled, site, sponsorshipEnabled } from '@/lib/config';
import { contributorSlugs } from '@/lib/contributors/byline';
import { getDb } from '@/lib/db';
import { listLivePromos } from '@/lib/promos/repo';
import { sitemapRows } from '@/lib/public/reads';
import { anonymousScope } from '@/lib/public/scope';
import { buildSitemap, flagPages } from '@/lib/public/sitemap';
import { listWorlds } from '@/lib/public/worlds';

export const dynamic = 'force-dynamic';

// The promotions hub and each live promo (promotions are data, so the list comes from the records; a read
// failure simply omits them rather than breaking the sitemap).
async function promoUrls(db: ReturnType<typeof getDb>): Promise<MetadataRoute.Sitemap> {
  if (!promosEnabled()) return [];
  try {
    const live = await listLivePromos(db, new Date());
    return [
      { url: `${site.url}/promos/` },
      ...live.map((p) => ({ url: `${site.url}/promos/${p.slug}/`, lastModified: p.updatedAt })),
    ];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!site.published) return [];
  const db = getDb();
  const [{ items, topics }, worlds, contributors, promos] = await Promise.all([
    sitemapRows(db, anonymousScope()),
    listWorlds(db),
    contributorSlugs(db, new Date()), // plan 8: empty with the flag off
    promoUrls(db),
  ]);
  return [
    ...buildSitemap(items, worlds.map((w) => w.slug), site.url, topics, flagPages({
      comments: commentsEnabled(),
      sponsorship: sponsorshipEnabled(),
      contributors: contributorsEnabled(),
    })),
    ...contributors.map((slug) => ({ url: `${site.url}/contributors/${slug}/` })),
    ...promos,
  ];
}
