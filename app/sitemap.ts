import type { MetadataRoute } from 'next';
import { commentsEnabled, contributorsEnabled, site, sponsorshipEnabled } from '@/lib/config';
import { contributorSlugs } from '@/lib/contributors/byline';
import { getDb } from '@/lib/db';
import { sitemapRows } from '@/lib/public/reads';
import { anonymousScope } from '@/lib/public/scope';
import { buildSitemap, flagPages } from '@/lib/public/sitemap';
import { listWorlds } from '@/lib/public/worlds';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!site.published) return [];
  const db = getDb();
  const [{ items, topics }, worlds, contributors] = await Promise.all([
    sitemapRows(db, anonymousScope()),
    listWorlds(db),
    contributorSlugs(db, new Date()), // plan 8: empty with the flag off
  ]);
  return [
    ...buildSitemap(items, worlds.map((w) => w.slug), site.url, topics, flagPages({
      comments: commentsEnabled(),
      sponsorship: sponsorshipEnabled(),
      contributors: contributorsEnabled(),
    })),
    ...contributors.map((slug) => ({ url: `${site.url}/contributors/${slug}/` })),
  ];
}
