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

  it('read play options, items and clues', () => {
    const p = readPlay({ mechanic: 'clue_reveal', prompt: 'P', clues: ['a', 'b'], options: [{ id: 'a', text: 'A' }] });
    expect(p.clues).toEqual(['a', 'b']);
    expect(p.options).toEqual([{ id: 'a', text: 'A' }]);
    expect(p.items).toEqual([]);
  });
});
