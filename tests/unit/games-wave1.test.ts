// Games wave 1 (21 Nov 2026): drag-match, fact-or-fiction, pattern, emotion-detectives and
// build-a-word. The guarantees pinned here mirror the visual-games suite: every sample's answer
// is PROVED from its data by the schema (tampering with the data breaks the proof), the match
// mechanic parses and checks like the other closed mechanics, and the play form renders each
// type's surface — the pattern strip never shows the missing piece, fact games speak
// Fact/Make-Believe, and the match board keeps its no-JavaScript selects.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { allGames } from '@/lib/content';
import { gameSchema } from '@/lib/schemas';
import { parseGiven, checkAnswer, describeAnswer } from '@/lib/play/check';
import PlayForm from '@/components/item/PlayForm';
import { readPlay, type PlayView } from '@/lib/public/body';
import { gameBodyFor } from '@/lib/items/import-legacy';

const byId = (id: string) => allGames.find((g) => g.id === id);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const parses = (g: unknown) => gameSchema.safeParse(g).success;

describe('wave 1 samples are in the collection', () => {
  it('ships 21 samples: 5 drag-match, 4 each of the other four types', () => {
    const wave = allGames.filter((g) => ['drag-match', 'fact-or-fiction', 'pattern', 'emotion-detectives', 'build-a-word'].includes(g.gameType));
    expect(wave).toHaveLength(21);
    expect(wave.filter((g) => g.gameType === 'drag-match')).toHaveLength(5);
    for (const t of ['fact-or-fiction', 'pattern', 'emotion-detectives', 'build-a-word']) {
      expect(wave.filter((g) => g.gameType === t), t).toHaveLength(4);
    }
  });
});

describe('drag-match proofs', () => {
  it('the hedgehog answer is the dot-count match, and swapping two cones breaks the proof', () => {
    const g = byId('drag-match-hedgehog-001');
    expect(g?.matchAnswer).toEqual(['cone-3', 'cone-1', 'cone-4', 'cone-5', 'cone-2']);
    const tampered = clone(g!);
    [tampered.matchAnswer![0], tampered.matchAnswer![1]] = [tampered.matchAnswer![1], tampered.matchAnswer![0]];
    expect(parses(tampered)).toBe(false);
  });

  it('habitat and sound matches are permutations of their pieces', () => {
    for (const id of ['drag-match-habitat-001', 'drag-match-sounds-001', 'drag-match-opposites-001']) {
      const g = byId(id);
      const pieceIds = (g?.visual.match?.pieces ?? []).map((p) => p.id).sort();
      expect([...(g?.matchAnswer ?? [])].sort(), id).toEqual(pieceIds);
    }
  });

  it('parseGiven + checkAnswer: the right board passes, a swapped board fails, a reused piece is malformed', () => {
    const g = byId('drag-match-hedgehog-001')!;
    const targets = g.visual.match!.targets.map((t) => t.id);
    const pieces = g.visual.match!.pieces.map((p) => p.id);
    const params = new URLSearchParams();
    targets.forEach((t, i) => params.set(`match-${t}`, g.matchAnswer![i]));
    const given = parseGiven('match_pairs', params, targets, pieces);
    expect(checkAnswer('match_pairs', g.matchAnswer, given)).toBe(true);
    const swapped = new URLSearchParams(params);
    swapped.set(`match-${targets[0]}`, g.matchAnswer![1]);
    swapped.set(`match-${targets[1]}`, g.matchAnswer![0]);
    expect(checkAnswer('match_pairs', g.matchAnswer, parseGiven('match_pairs', swapped, targets, pieces))).toBe(false);
    const reused = new URLSearchParams(params);
    reused.set(`match-${targets[1]}`, g.matchAnswer![0]);
    expect(parseGiven('match_pairs', reused, targets, pieces)).toBeNull();
  });

  it('describeAnswer reads a match key as pairs', () => {
    const g = byId('drag-match-sounds-001')!;
    const body = { visual: { gameType: 'drag-match', match: g.visual.match } };
    expect(describeAnswer(body, g.matchAnswer)).toContain('B → Bear');
  });
});

describe('fact-or-fiction proofs', () => {
  it('the fact games agree with their flags, and flipping a flag breaks the proof', () => {
    expect(byId('fact-or-fiction-001')?.correctOptionId).toBe('fact');
    expect(byId('fact-or-fiction-002')?.correctOptionId).toBe('make-believe');
    const tampered = clone(byId('fact-or-fiction-001')!);
    tampered.visual.statementIsFact = false;
    expect(parses(tampered)).toBe(false);
  });

  it('every fact game carries a real source; dropping it breaks the proof', () => {
    for (const id of ['fact-or-fiction-001', 'fact-or-fiction-002', 'fact-or-fiction-003', 'fact-or-fiction-004']) {
      const g = byId(id);
      expect(g?.sources.length, id).toBeGreaterThan(0);
      const tampered = clone(g!);
      tampered.sources = [];
      expect(parses(tampered), id).toBe(false);
    }
  });

  it('describeAnswer speaks Fact / Make-Believe for this type only', () => {
    expect(describeAnswer({ visual: { gameType: 'fact-or-fiction' } }, true)).toBe('Fact');
    expect(describeAnswer({ visual: { gameType: 'fact-or-fiction' } }, false)).toBe('Make-Believe');
    expect(describeAnswer({ visual: { gameType: 'observation' } }, true)).toBe('True');
  });
});

describe('pattern proofs', () => {
  it('the correct option is exactly the missing sequence entry in all four samples', () => {
    for (const id of ['pattern-001', 'pattern-002', 'pattern-003', 'pattern-004']) {
      const g = byId(id)!;
      const missing = g.visual.sequence![g.visual.missingPosition! - 1];
      const correct = g.options!.find((o) => o.id === g.correctOptionId)!;
      expect(correct.art, id).toBe(missing.art);
      expect(correct.text, id).toBe(missing.label);
    }
  });

  it('moving the gap or re-keying the answer breaks the proof', () => {
    const moved = clone(byId('pattern-001')!);
    moved.visual.missingPosition = 2;
    expect(parses(moved)).toBe(false);
    const rekeyed = clone(byId('pattern-004')!);
    rekeyed.correctOptionId = 'a';
    expect(parses(rekeyed)).toBe(false);
  });
});

describe('emotion-detectives proofs', () => {
  it('the correct option is the declared feeling; renaming the feeling breaks the proof', () => {
    const g = byId('emotion-detectives-003');
    expect(g?.visual.feeling).toBe('Thankful');
    expect(g?.options?.find((o) => o.id === g.correctOptionId)?.text).toBe('Thankful');
    const tampered = clone(g!);
    tampered.visual.feeling = 'Angry';
    expect(parses(tampered)).toBe(false);
  });
});

describe('build-a-word proofs', () => {
  it('tiles are exactly the word letters (plus the declared decoy on apple)', () => {
    expect(byId('build-a-word-001')?.wordAnswer).toBe('cat');
    expect([...(byId('build-a-word-004')?.visual.tiles ?? [])].sort().join('')).toBe('aelpps');
    const tampered = clone(byId('build-a-word-001')!);
    tampered.visual.tiles = ['t', 'c', 'z'];
    expect(parses(tampered)).toBe(false);
    const undeclared = clone(byId('build-a-word-004')!);
    delete undeclared.visual.decoyLetter;
    expect(parses(undeclared)).toBe(false);
  });
});

describe('the public play body never carries a wave 1 answer key (review H1)', () => {
  it('readPlay strips statementIsFact, feeling and decoyLetter from stored bodies', () => {
    for (const id of ['fact-or-fiction-001', 'emotion-detectives-001', 'build-a-word-004']) {
      const view = readPlay(gameBodyFor(byId(id)!)) as unknown as Record<string, unknown>;
      const visual = view.visual as Record<string, unknown>;
      expect(visual.statementIsFact, id).toBeUndefined();
      expect(visual.feeling, id).toBeUndefined();
      expect(visual.decoyLetter, id).toBeUndefined();
      expect(JSON.stringify(view), id).not.toContain('statementIsFact');
    }
    // …while the surfaces the players need survive the reader.
    const fact = readPlay(gameBodyFor(byId('fact-or-fiction-001')!));
    expect(fact.visual?.statement).toContain('Bees make honey');
    const word = readPlay(gameBodyFor(byId('build-a-word-004')!));
    expect(word.visual?.tiles).toHaveLength(6);
  });
});

describe('wave 1 play surfaces', () => {
  const render = (play: PlayView) => renderToStaticMarkup(createElement(PlayForm, { action: '/play/fx/', play, clues: 0 }));
  const base = { items: [], clues: [], difficulty: 'easy' as const };

  it('pattern: the strip shows a gap chip and never names the missing piece in its label', () => {
    const g = byId('pattern-004')!;
    const html = render({
      ...base,
      mechanic: 'multiple_choice',
      prompt: g.prompt,
      options: g.options!.map((o) => ({ id: o.id, text: o.text, art: o.art, alt: o.alt, color: o.color })),
      visual: { gameType: 'pattern', sequence: g.visual.sequence!, missingPosition: g.visual.missingPosition },
    });
    expect(html).toContain('pattern-strip');
    expect(html).toContain('a missing piece');
    expect(html).toContain('pattern-gap');
  });

  it('fact-or-fiction: the statement card shows and the choices read Fact / Make-Believe', () => {
    const g = byId('fact-or-fiction-001')!;
    const html = render({
      ...base,
      mechanic: 'true_false',
      prompt: g.prompt,
      options: [],
      visual: { gameType: 'fact-or-fiction', sequence: [], statement: g.visual.statement },
    });
    expect(html).toContain('statement-card');
    expect(html).toContain('Bees make honey');
    expect(html).toContain('Make-Believe');
  });

  it('drag-match: one select per target is the no-JavaScript game', () => {
    const g = byId('drag-match-hedgehog-001')!;
    const html = render({
      ...base,
      mechanic: 'match_pairs',
      prompt: g.prompt,
      options: [],
      visual: { gameType: 'drag-match', sequence: [], match: g.visual.match },
    });
    expect(html).toContain('match-area');
    for (const t of g.visual.match!.targets) expect(html).toContain(`name="match-${t.id}"`);
  });

  it('build-a-word: the tiles sit over the same text input the server checks', () => {
    const g = byId('build-a-word-001')!;
    const html = render({
      ...base,
      mechanic: 'short_text',
      prompt: g.prompt,
      options: [],
      visual: { gameType: 'build-a-word', sequence: [], heroArt: 'cat', heroAlt: g.visual.heroAlt, tiles: g.visual.tiles },
    });
    expect(html).toContain('word-tiles');
    expect(html).toContain('name="r"');
    expect(html).toContain('tile');
  });

  it('emotion-detectives: the scenario card carries the story', () => {
    const g = byId('emotion-detectives-001')!;
    const html = render({
      ...base,
      mechanic: 'multiple_choice',
      prompt: g.prompt,
      options: g.options!,
      visual: { gameType: 'emotion-detectives', sequence: [], scenario: g.visual.scenario },
    });
    expect(html).toContain('scenario-card');
    expect(html).toContain('tower of blocks');
  });
});
