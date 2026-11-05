// The link every post carries, built by the server only (plan 5A): the item page with fixed UTM values. The agent never
// writes a URL; world and slug come from the database and are re-checked against the slug pattern here.
// No Next.js imports. Verified by tests/unit/social-rules.test.ts.
import { isPlatform, type Platform } from './states';

const SLUG = /^[a-z0-9-]{1,80}$/;

export function siteBase(site: string): string {
  const u = new URL(site);
  if (u.protocol !== 'https:' || u.username || u.password || (u.pathname !== '/' && u.pathname !== '')) {
    throw new Error('The site address must be a bare https origin');
  }
  return u.origin;
}

export function buildLink(site: string, item: { world: string; slug: string }, platform: Platform): string {
  if (!isPlatform(platform) || !SLUG.test(item.world) || !SLUG.test(item.slug)) throw new Error('Cannot build a social link');
  const u = new URL(`${siteBase(site)}/${item.world}/${item.slug}/`);
  u.searchParams.set('utm_source', platform);
  u.searchParams.set('utm_medium', 'social');
  u.searchParams.set('utm_campaign', `${item.world}-${item.slug}`);
  return u.toString();
}
