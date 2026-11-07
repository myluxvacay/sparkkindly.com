import type { PublicItem } from '@/lib/items/repo';
import { readImage } from './body';

// Structured data for public pages. Deliberately no builder for quizzes or questions: schema.org's Quiz and Question
// types carry accepted answers, and an answer must never appear in a page before it is submitted.
const url = (baseUrl: string, path: string) => `${baseUrl}${path}`;
const CONTEXT = 'https://schema.org';
const NAME = 'SparkKindly';

// The Organization (SEO audit M1): on the home page with sameAs for the social links that are set, and as an
// Article's publisher (without @context, nested).
function organization(baseUrl: string): Record<string, unknown> {
  return { '@type': 'Organization', name: NAME, url: url(baseUrl, '/'), logo: url(baseUrl, '/brand/icon-512.png') };
}

export function organizationLd(baseUrl: string, socials: Record<string, string | null>): object {
  const sameAs = Object.values(socials).filter((s): s is string => !!s);
  return { '@context': CONTEXT, ...organization(baseUrl), ...(sameAs.length ? { sameAs } : {}) };
}

export function websiteLd(baseUrl: string): object {
  return { '@context': CONTEXT, '@type': 'WebSite', name: NAME, url: url(baseUrl, '/') };
}

// An absolute URL for an item's hero image, or null (a relative path is on this site; anything else is dropped).
function heroUrl(item: PublicItem, baseUrl: string): string | null {
  const src = readImage(item.image).src;
  if (!src) return null;
  if (/^https:\/\//.test(src)) return src;
  return src.startsWith('/') ? url(baseUrl, src) : null;
}

// author: the credited contributor of a published contributed item (plan 8), else SparkKindly (SEO audit M2).
export function articleLd(item: PublicItem, baseUrl: string, author?: { name: string; slug: string }): object {
  const path = `/${item.world}/${item.slug}/`;
  const hero = heroUrl(item, baseUrl);
  return {
    '@context': CONTEXT,
    '@type': 'Article',
    headline: item.title,
    description: item.summary,
    datePublished: item.publishedAt.toISOString(),
    dateModified: item.updatedAt.toISOString(),
    mainEntityOfPage: url(baseUrl, path),
    image: [...(hero ? [hero] : []), url(baseUrl, `/api/template-image/${item.world}/${item.slug}/`)],
    publisher: organization(baseUrl),
    author: author
      ? { '@type': 'Person', name: author.name, url: url(baseUrl, `/contributors/${author.slug}/`) }
      : { '@type': 'Organization', name: NAME, url: url(baseUrl, '/') },
  };
}

export function breadcrumbLd(baseUrl: string, trail: { name: string; path: string }[]): object {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: url(baseUrl, t.path) })),
  };
}
