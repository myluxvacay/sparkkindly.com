// ArticleBody section image (step strip, owner request 21 Nov 2026): a section that carries an
// image renders it as a full-width picture at the top of the section, above the step text; a
// section without one renders exactly as before (no img anywhere in the body).
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ArticleBody from '@/components/item/ArticleBody';
import type { ArticleView } from '@/lib/public/body';

const strip = {
  src: '/images/poster-volcano-model-steps.webp',
  alt: 'The volcano build in four pictures',
  width: 1572,
  height: 405,
  credit: 'AI-generated image · SparkKindly',
  rights: 'Generated for SparkKindly',
};

const view = (withImage: boolean): ArticleView => ({
  sections: [
    { heading: 'Meet the parts', paragraphs: ['The magma chamber.'] },
    {
      heading: 'How it works — step by step',
      paragraphs: ['Step 1 — Build the cone.'],
      ...(withImage ? { image: strip } : {}),
    },
  ],
  takeaway: 'A volcano is underground plumbing.',
});

describe('ArticleBody section image', () => {
  it('renders the strip at the top of its section, before the step text', () => {
    const html = renderToStaticMarkup(<ArticleBody article={view(true)} />);
    expect(html).toContain('poster-volcano-model-steps.webp');
    expect(html).toContain('alt="The volcano build in four pictures"');
    expect(html.indexOf('poster-volcano-model-steps')).toBeGreaterThan(html.indexOf('How it works'));
    expect(html.indexOf('poster-volcano-model-steps')).toBeLessThan(html.indexOf('Step 1'));
    // Only the strip section carries an image.
    expect(html.match(/<img/g)).toHaveLength(1);
  });

  it('renders no image when no section carries one', () => {
    const html = renderToStaticMarkup(<ArticleBody article={view(false)} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('Step 1 — Build the cone.');
  });
});
