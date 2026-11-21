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

const panels = [1, 2, 3, 4].map((n) => ({
  src: `/images/poster-volcano-model-steps-${n}.webp`,
  alt: `Step ${n} of 4`,
  width: 385,
  height: 377,
  credit: 'AI-generated image · SparkKindly',
  rights: 'Generated for SparkKindly',
}));

const view = (withImage: boolean, withPanels = false): ArticleView => ({
  sections: [
    { heading: 'Meet the parts', paragraphs: ['The magma chamber.'] },
    {
      heading: 'How it works — step by step',
      paragraphs: ['Step 1 — Build the cone.'],
      ...(withImage ? { image: strip } : {}),
      ...(withPanels ? { imagePanels: panels } : {}),
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

  it('renders the panel set as the strip mobile arrangement, in step order, after the strip', () => {
    const html = renderToStaticMarkup(<ArticleBody article={view(true, true)} />);
    // The strip gains the swap class only when a panel set exists.
    expect(html).toContain('class="section-image section-image-strip"');
    expect(html).toContain('class="section-panels"');
    // Strip first, then the grid, then the step text; panels in step order 1-2-3-4.
    const stripAt = html.indexOf('poster-volcano-model-steps.webp');
    const gridAt = html.indexOf('section-panels');
    const pos = [1, 2, 3, 4].map((n) => html.indexOf(`poster-volcano-model-steps-${n}.webp`));
    expect(stripAt).toBeGreaterThan(-1);
    expect(gridAt).toBeGreaterThan(stripAt);
    expect(pos[0]).toBeGreaterThan(gridAt);
    expect(pos[1]).toBeGreaterThan(pos[0]);
    expect(pos[2]).toBeGreaterThan(pos[1]);
    expect(pos[3]).toBeGreaterThan(pos[2]);
    expect(pos[3]).toBeLessThan(html.indexOf('Step 1 — Build the cone.'));
    expect(html.match(/<img/g)).toHaveLength(5);
  });

  it('renders no panel grid when the section has a strip but no panel set', () => {
    const html = renderToStaticMarkup(<ArticleBody article={view(true)} />);
    expect(html).not.toContain('section-panels');
    expect(html).not.toContain('section-image-strip');
  });
});
