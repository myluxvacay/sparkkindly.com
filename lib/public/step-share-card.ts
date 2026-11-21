import { readArticle } from './body';

// Step-strip share cards (owner request, 21 Nov 2026): when an article's step section carries a
// strip and its panel set, the social share image is the 1200x630 card composed from those panels
// (a 2x2 comic teaser) instead of the generic template card — the sequence creates curiosity and
// pulls clicks into the article. The card is a static file minted by
// scripts/make-step-share-card.ts and named by convention from the strip: the strip at
// /images/<base>.webp has its card at /images/<base>-share.jpg. Articles without a panel set
// return null here and keep the template share image, unchanged.
export type StepShareCard = { url: string; width: 1200; height: 630; alt: string };

export function stepShareCard(body: unknown, fallbackAlt: string): StepShareCard | null {
  const article = readArticle(body);
  for (const section of article.sections) {
    const strip = section.image?.src;
    const panels = (section.imagePanels ?? []).filter((p) => p.src);
    if (!strip || panels.length < 2) continue;
    const base = strip.replace(/\.[a-z0-9]+$/i, '');
    if (!base || base === strip) continue;
    return { url: `${base}-share.jpg`, width: 1200, height: 630, alt: section.image?.alt || fallbackAlt };
  }
  return null;
}
