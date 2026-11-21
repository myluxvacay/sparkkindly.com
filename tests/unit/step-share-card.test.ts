// Step-strip share cards (21 Nov 2026): an article whose step section carries a strip plus its
// panel set shares the 1200x630 card composed from the panels; every other article returns null
// and keeps the template share image. The selector is defensive like every public body reader —
// a malformed body yields null, never a throw.
import { describe, it, expect } from 'vitest';
import { stepShareCard } from '@/lib/public/step-share-card';

const panel = (n: number) => ({ src: `/images/poster-volcano-model-steps-${n}.webp`, alt: `Step ${n} of 4` });
const stripBody = {
  sections: [
    { heading: 'Meet the parts', paragraphs: ['...'] },
    {
      heading: 'How it works — step by step',
      paragraphs: ['Step 1 ...'],
      image: { src: '/images/poster-volcano-model-steps.webp', alt: 'The volcano build in four pictures' },
      imagePanels: [panel(1), panel(2), panel(3), panel(4)],
    },
  ],
};

describe('stepShareCard', () => {
  it('returns the convention-named 1200x630 card for a strip article, with the strip alt', () => {
    expect(stepShareCard(stripBody, 'Volcano Model')).toEqual({
      url: '/images/poster-volcano-model-steps-share.jpg',
      width: 1200,
      height: 630,
      alt: 'The volcano build in four pictures',
    });
  });

  it('falls back to the item title when the strip carries no alt', () => {
    const body = {
      sections: [
        { heading: 'Steps', paragraphs: [], image: { src: '/images/x-steps.webp' }, imagePanels: [panel(1), panel(2)] },
      ],
    };
    expect(stepShareCard(body, 'Some Title')?.alt).toBe('Some Title');
  });

  it('returns null for a plain article (no section images at all)', () => {
    const body = { sections: [{ heading: 'Intro', paragraphs: ['Hello'] }] };
    expect(stepShareCard(body, 'Plain')).toBeNull();
  });

  it('returns null when a strip has no panel set, and when panels have no strip', () => {
    const stripOnly = { sections: [{ heading: 'Steps', paragraphs: [], image: { src: '/images/x-steps.webp', alt: 'a' } }] };
    expect(stepShareCard(stripOnly, 'T')).toBeNull();
    const panelsOnly = { sections: [{ heading: 'Steps', paragraphs: [], imagePanels: [panel(1), panel(2)] }] };
    expect(stepShareCard(panelsOnly, 'T')).toBeNull();
  });

  it('returns null for a single-panel set (no teaser grid to compose)', () => {
    const body = {
      sections: [{ heading: 'Steps', paragraphs: [], image: { src: '/images/x-steps.webp', alt: 'a' }, imagePanels: [panel(1)] }],
    };
    expect(stepShareCard(body, 'T')).toBeNull();
  });

  it('never throws on malformed bodies', () => {
    for (const bad of [null, undefined, 42, 'nope', [], { sections: 'x' }, { sections: [null, { image: 7 }] }]) {
      expect(stepShareCard(bad, 'T')).toBeNull();
    }
  });
});
