import type { PublicItem } from '@/lib/items/repo';

// Structured data for public pages. Deliberately no builder for quizzes or questions: schema.org's Quiz and Question
// types carry accepted answers, and an answer must never appear in a page before it is submitted.
const url = (baseUrl: string, path: string) => `${baseUrl}${path}`;

export function articleLd(item: PublicItem, baseUrl: string): object {
  const path = `/${item.world}/${item.slug}/`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: item.title,
    description: item.summary,
    datePublished: item.publishedAt.toISOString(),
    mainEntityOfPage: url(baseUrl, path),
    image: url(baseUrl, `/api/template-image/${item.world}/${item.slug}/`),
    publisher: { '@type': 'Organization', name: 'SparkKindly' },
  };
}

export function breadcrumbLd(baseUrl: string, trail: { name: string; path: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: url(baseUrl, t.path) })),
  };
}
