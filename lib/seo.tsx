import type { Metadata } from 'next';
import { site } from './config';

const BANNER_ALT = 'SparkKindly — Think sharp. Be kind. Brand artwork for Play, Discover, Together, Grow, Save and Kids.';

// absoluteTitle: the title is used as is, without the layout's "%s | SparkKindly" template (the home page, SEO audit H2).
// image: a page-specific share image (Open Graph + Twitter), overriding the site banner; 1200x630 unless said.
export type SeoOptions = {
  absoluteTitle?: boolean;
  image?: { url: string; width?: number; height?: number; alt?: string };
};

// Released and indexable pages allow large image previews (SEO audit L3); preview builds are never indexed.
export const pageRobots = (): Metadata['robots'] =>
  site.published ? { index: true, follow: true, 'max-image-preview': 'large' } : { index: false, follow: false };

export function metadata(title: string, description: string, path: string, o: SeoOptions = {}): Metadata {
  const img = o.image ?? { url: '/brand/social-banner.jpg', alt: BANNER_ALT };
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
      images: [{ url: img.url, width: img.width ?? 1200, height: img.height ?? 630, alt: img.alt ?? BANNER_ALT }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [img.url] },
    robots: pageRobots(),
  };
}

export const escapeJsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: escapeJsonLd(data) }} />;
}
