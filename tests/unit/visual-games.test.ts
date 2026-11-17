// Visual picture games (#21, 17 Nov 2026): the starter set must stay playable and verified — every round's
// correct answer is one of its own options, every image carries alt text, and each game type has its rounds.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { visualGameKinds, visualRounds } from '@/lib/games/visual-games';

const gamesSrc = readFileSync(`${process.cwd()}/components/games/VisualGames.tsx`, 'utf8');
const css = readFileSync(`${process.cwd()}/app/globals.css`, 'utf8');

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
        // Art and alt come as a pair; a text-only option has neither, and its label is the accessible name.
        expect(Boolean(o.art), `${r.id}/${o.id} art/alt pairing`).toBe(Boolean(o.alt));
        if (o.art) expect(o.alt!.length, `${r.id}/${o.id} alt`).toBeGreaterThan(10);
        else expect(o.label.length, `${r.id}/${o.id} text-only label`).toBeGreaterThan(1);
      }
      if (r.hero) expect(r.hero.alt.length).toBeGreaterThan(10);
    }
  });

  it('no round repeats its hero image among the answer options (no picture-matching the hero)', () => {
    for (const r of visualRounds) {
      expect(r.options.map((o) => o.id), `${r.id} correctId offered`).toContain(r.correctId);
      if (!r.hero) continue;
      for (const o of r.options) expect(o.art, `${r.id}/${o.id} repeats the hero`).not.toBe(r.hero.art);
    }
    // The reported instance: Brazil's flag is the hero, so its options are country-name cards, no flag art.
    const brazil = visualRounds.find((r) => r.id === 'place-brazil-flag')!;
    expect(brazil.hero?.art).toBe('flag-br');
    expect(brazil.options.every((o) => o.art === undefined)).toBe(true);
    expect(brazil.options.map((o) => o.label)).toEqual(['Argentina', 'Mexico', 'Brazil', 'Portugal']);
  });

  it('text-only options render as label cards in the same option family, without artwork', () => {
    expect(gamesSrc).toContain("o.art ? '' : ' vg-option-text'");
    expect(gamesSrc).toContain('{o.art && <GameArt');
    expect(css).toMatch(/\.vg-option-text\{[^}]*min-height:/);
  });

  it('odd-one-out rounds offer exactly four pictures, like the existing mechanic', () => {
    for (const r of visualRounds.filter((x) => x.kind === 'odd-one-out')) expect(r.options).toHaveLength(4);
  });

  it('flags-and-places includes at least one reverse round (name the country, pick its flag)', () => {
    const reverse = visualRounds.filter((r) => r.kind === 'flags-and-places' && !r.hero);
    expect(reverse.length).toBeGreaterThanOrEqual(1);
    expect(reverse[0].prompt.toLowerCase()).toContain('reverse');
  });

  it('Spark presenter uses the waving GIF and the named reaction slots with their fallbacks', () => {
    expect(gamesSrc).not.toContain('spark-220.webp');
    // Slot mapping: victory falls back to the waving GIF, encouraging to the still Spark (SPARK-ANIMATIONS.md).
    expect(gamesSrc).toContain("victory: { animated: '/brand/spark-victory.gif', fallback: '/brand/spark-waving.gif', still: '/brand/spark.webp', voice: '/brand/spark-you-did-it.mp3' }");
    expect(gamesSrc).toContain("encouraging: { animated: '/brand/spark-encouraging.gif', fallback: '/brand/spark.webp', still: '/brand/spark.webp', voice: '/brand/spark-you-got-this.mp3' }");
    expect(gamesSrc).toContain("presenting: { animated: '/brand/spark-waving.gif', fallback: '/brand/spark.webp', still: '/brand/spark.webp' }");
    // Correct pick shows the victory slot, a wrong pick the encouraging slot.
    expect(gamesSrc).toContain("slot={solved ? 'victory' : picked ? 'encouraging' : 'presenting'}");
    // Reduced motion: the still Spark in every slot.
    expect(gamesSrc).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(gamesSrc).toContain('reducedMotion ? conf.still');
  });

  it("Spark's reaction voice plays only on the player's own answer click, behind a persisted toggle", () => {
    // The two clips are wired to the pick handler — correct and wrong branches respectively.
    expect(gamesSrc).toContain('playClip(SPARK_SLOTS.victory.voice)');
    expect(gamesSrc).toContain('playClip(SPARK_SLOTS.encouraging.voice)');
    // No autoplay anywhere, and play() rejections are guarded.
    expect(gamesSrc).not.toContain('autoPlay');
    expect(gamesSrc).toContain("void a.play().catch(() => {})");
    // The clips are not in the markup (created lazily on first interaction, not preloaded on load).
    expect(gamesSrc).not.toContain('<audio');
    expect(gamesSrc).toContain("a.preload = 'auto'");
    // Visible toggle, default on, persisted in localStorage.
    expect(gamesSrc).toContain('aria-pressed={soundOn}');
    expect(gamesSrc).toContain("localStorage.getItem(SOUND_KEY) !== 'off'");
    expect(gamesSrc).toContain("localStorage.setItem(SOUND_KEY, on ? 'off' : 'on')");
  });

  it('"Show me the answer" is a real button: its own gold face with dark ink at AA contrast', () => {
    // The control is a <button class="underlined vg-give-up">. The first fix pinned only its text colour
    // (#ffe087), which sat on the UA default pale button face and vanished (owner screenshot). The rule
    // must now declare the button's OWN background and text colour, and the pair must meet WCAG 2.2 AA.
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    expect(gamesSrc).toContain('vg-give-up');
    const rule = css.match(/\.vg-panel \.vg-give-up\{([^}]*)\}/)?.[1] ?? '';
    const bg = rule.match(/background:(#[0-9a-f]{6})/)?.[1];
    const fg = rule.match(/(?:^|;)color:(#[0-9a-f]{6})/)?.[1];
    expect(bg, 'give-up button declares its own background').toBeDefined();
    expect(fg, 'give-up button declares its own text colour').toBeDefined();
    expect(ratio(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
    // The button face must also stand out from the plum panel it sits on, and keep a 44px tap target.
    expect(ratio(bg!, '#5b2c6f')).toBeGreaterThanOrEqual(3);
    expect(rule).toContain('min-height:44px');
    // The old colour-only pin must not come back.
    expect(css).not.toMatch(/\.vg-panel \.vg-give-up\{color:#ffe087\}/);
  });

  it('panel text is light on the dark plum panel (the prompt must never be dark-on-dark)', () => {
    // The panel surface is .quiz-panel plum; global h2 colour is plum too, so the game rules must pin light text.
    expect(css).toMatch(/\.vg-panel h2\{color:#fdf6ec\}/);
    expect(css).toMatch(/\.vg-round-count\{[^}]*color:#ffe087/);
    expect(css).not.toMatch(/\.vg-round-count\{[^}]*color:#5a2d82/);
    expect(css).toMatch(/\.vg-spark-says\{[^}]*color:#fdf6ec/);
    expect(css).toMatch(/\.vg-panel \.quiz-note\{color:#e7d7f2\}/);
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
