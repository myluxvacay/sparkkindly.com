import type { MetadataRoute } from 'next';
import { site } from '@/lib/config';
import { getDb } from '@/lib/db';
import { sitemapRows } from '@/lib/public/reads';
import { anonymousScope } from '@/lib/public/scope';
import { buildSitemap } from '@/lib/public/sitemap';
import { listWorlds } from '@/lib/public/worlds';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!site.published) return [];
  const db = getDb();
  const [{ items, topics }, worlds] = await Promise.all([sitemapRows(db, anonymousScope()), listWorlds(db)]);
  return buildSitemap(items, worlds.map((w) => w.slug), site.url, topics);
}
