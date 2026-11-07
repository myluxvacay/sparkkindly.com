import type { Metadata } from 'next';
import { site } from './config';

const BANNER_ALT = 'SparkKindly — Think sharp. Be kind. Brand artwork for Play, Discover, Together, Grow and Kids.';

// absoluteTitle: the title is used as is, without the layout's "%s | SparkKindly" template (the home page, SEO audit H2).
export type SeoOptions = { absoluteTitle?: boolean };

// Released and indexable pages allow large image previews (SEO audit L3); preview builds are never indexed.
export const pageRobots = (): Metadata['robots'] =>
  site.published ? { index: true, follow: true, 'max-image-preview': 'large' } : { index: false, follow: false };

export function metadata(title: string, description: string, path: string, o: SeoOptions = {}): Metadata {
  return {
    title: o.absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: site.name,
      locale: 'en_GB',
      type: 'website',
      images: [{ url: '/brand/social-banner.jpg', width: 1200, height: 630, alt: BANNER_ALT }],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/brand/social-banner.jpg'] },
    robots: pageRobots(),
  };
}

export const escapeJsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: escapeJsonLd(data) }} />;
}
