import { describe, expect, it } from 'vitest';
import { readArticle, readImage, readPlay } from '@/lib/public/body';

describe('public body readers', () => {
  it('never throw on malformed bodies', () => {
    for (const bad of [null, undefined, 5, 'x', [], { sections: 'no', takeaway: 7, materials: [1], options: {} }]) {
      expect(() => readArticle(bad)).not.toThrow();
      expect(() => readPlay(bad)).not.toThrow();
      expect(() => readImage(bad)).not.toThrow();
    }
  });

  it('drop a field of the wrong type and keep the rest', () => {
    const a = readArticle({ sections: [{ heading: 'H', paragraphs: ['p'] }], takeaway: 'T', materials: [1], supervision: 'Adult' });
    expect(a.sections).toHaveLength(1);
    expect(a.takeaway).toBe('T');
    expect(a.materials).toBeUndefined();
    expect(a.supervision).toBe('Adult');
  });

  it('keep a section image (the step strip) and drop a malformed one', () => {
    const good = readArticle({
      sections: [
        { heading: 'Steps', paragraphs: ['p'], image: { src: '/images/x-steps.webp', alt: 'strip', width: 1572, height: 405, credit: 'c', rights: 'r' } },
        { heading: 'Bad', paragraphs: ['p'], image: { src: 7, alt: 'x' } },
        { heading: 'Plain', paragraphs: ['p'] },
      ],
      takeaway: 'T',
    });
    expect(good.sections[0].image).toEqual({ src: '/images/x-steps.webp', alt: 'strip', width: 1572, height: 405, credit: 'c', rights: 'r' });
    expect(good.sections[1].image?.src).toBeUndefined();
    expect(good.sections[2].image).toBeUndefined();
  });

  it('keep a section imagePanels set (the strip mobile arrangement) and drop a malformed one', () => {
    const panel = (n: number) => ({ src: `/images/x-steps-${n}.webp`, alt: `Step ${n}`, width: 385, height: 377, credit: 'c', rights: 'r' });
    const good = readArticle({
      sections: [
        { heading: 'Steps', paragraphs: ['p'], imagePanels: [panel(1), panel(2)] },
        { heading: 'Bad', paragraphs: ['p'], imagePanels: 'nope' },
        { heading: 'Plain', paragraphs: ['p'] },
      ],
      takeaway: 'T',
    });
    expect(good.sections[0].imagePanels).toEqual([panel(1), panel(2)]);
    expect(good.sections[1].imagePanels).toBeUndefined();
    expect(good.sections[2].imagePanels).toBeUndefined();
  });

  it('read play options, items and clues', () => {
    const p = readPlay({ mechanic: 'clue_reveal', prompt: 'P', clues: ['a', 'b'], options: [{ id: 'a', text: 'A' }] });
    expect(p.clues).toEqual(['a', 'b']);
    expect(p.options).toEqual([{ id: 'a', text: 'A' }]);
    expect(p.items).toEqual([]);
  });

  it('keep a valid difficulty and drop an invalid one', () => {
    expect(readPlay({ prompt: 'P', difficulty: 'medium' }).difficulty).toBe('medium');
    expect(readPlay({ prompt: 'P', difficulty: 'extreme' }).difficulty).toBeUndefined();
    expect(readPlay({ prompt: 'P' }).difficulty).toBeUndefined();
  });
});
