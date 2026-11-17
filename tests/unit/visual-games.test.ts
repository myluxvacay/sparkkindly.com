// Visual picture games (#21, 17 Nov 2026): the starter set must stay playable and verified — every round's
// correct answer is one of its own options, every image carries alt text, and each game type has its rounds.
import { describe, it, expect } from 'vitest';
import { visualGameKinds, visualRounds } from '@/lib/games/visual-games';

describe('visual games starter set', () => {
  it('has at least six rounds, at least two per game type', () => {
    expect(visualRounds.length).toBeGreaterThanOrEqual(6);
    for (const { kind } of visualGameKinds) {
      expect(visualRounds.filter((r) => r.kind === kind).length, kind).toBeGreaterThanOrEqual(2);
    }
    expect(visualGameKinds.map((g) => g.kind)).toEqual(['odd-one-out', 'pick-the-right-one', 'flags-and-places']);
  });

  it('every round is self-consistent: unique ids, correct answer offered, kind explanations', () => {
    const roundIds = new Set<string>();
    for (const r of visualRounds) {
      expect(roundIds.has(r.id)).toBe(false);
      roundIds.add(r.id);
      expect(r.options.length).toBeGreaterThanOrEqual(3);
      expect(r.options.map((o) => o.id)).toContain(r.correctId);
      expect(new Set(r.options.map((o) => o.id)).size).toBe(r.options.length);
      expect(r.prompt.length).toBeGreaterThan(5);
      expect(r.explanation.length).toBeGreaterThan(20);
      expect(r.sparkRight.length).toBeGreaterThan(3);
      expect(r.sparkTryAgain.length).toBeGreaterThan(3);
      for (const o of r.options) {
        expect(o.alt.length, `${r.id}/${o.id} alt`).toBeGreaterThan(10);
        expect(o.art.length).toBeGreaterThan(0);
      }
      if (r.hero) expect(r.hero.alt.length).toBeGreaterThan(10);
    }
  });

  it('odd-one-out rounds offer exactly four pictures, like the existing mechanic', () => {
    for (const r of visualRounds.filter((x) => x.kind === 'odd-one-out')) expect(r.options).toHaveLength(4);
  });

  it('flags-and-places includes at least one reverse round (name the country, pick its flag)', () => {
    const reverse = visualRounds.filter((r) => r.kind === 'flags-and-places' && !r.hero);
    expect(reverse.length).toBeGreaterThanOrEqual(1);
    expect(reverse[0].prompt.toLowerCase()).toContain('reverse');
  });

  it('the verified answers are the facts the explanations state', () => {
    const byId = Object.fromEntries(visualRounds.map((r) => [r.id, r]));
    expect(byId['odd-fruit-car'].correctId).toBe('car');
    expect(byId['odd-flowers-mushroom'].correctId).toBe('mushroom');
    expect(byId['right-flag-japan'].correctId).toBe('japan');
    expect(byId['right-penguin'].correctId).toBe('penguin');
    expect(byId['place-eiffel'].correctId).toBe('france');
    expect(byId['place-brazil-flag'].correctId).toBe('brazil');
    expect(byId['place-canada-reverse'].correctId).toBe('canada');
  });
});
