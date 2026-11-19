// Visual picture games: the starter rounds from 17 Nov 2026 (owner #21) plus the 18 Nov 2026
// collection. The siloed /games/ player was retired by owner direction (18 Nov 2026) — the rounds
// now live as library content in the regular question flow — so the guarantees that test pinned
// (verified answers, the hero rule, art/alt pairing, voice only on the player's own action, behind
// the persisted toggle) are pinned here against the new surfaces that carry them.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { allGames } from '@/lib/content';
import { SPARK_VOICE } from '@/lib/games/spark-voice';
import PlayForm from '@/components/item/PlayForm';
import type { PlayView } from '@/lib/public/body';

const playFormSrc = readFileSync(`${process.cwd()}/components/item/PlayForm.tsx`, 'utf8');
const playPanelSrc = readFileSync(`${process.cwd()}/components/item/PlayPanel.tsx`, 'utf8');
const enhancerSrc = readFileSync(`${process.cwd()}/components/item/PlayEnhancer.tsx`, 'utf8');
const assistantSrc = readFileSync(`${process.cwd()}/components/SparkAssistant.tsx`, 'utf8');
const toggleSrc = readFileSync(`${process.cwd()}/components/games/SparkSoundToggle.tsx`, 'utf8');

const byId = (id: string) => allGames.find((g) => g.id === id);

describe('the 17 Nov starter rounds, as library games', () => {
  it('all seven rounds are in the collection with their verified answers', () => {
    expect(byId('odd-fruit-car')?.correctOptionId).toBe('car');
    expect(byId('odd-flowers-mushroom')?.correctOptionId).toBe('mushroom');
    expect(byId('right-flag-japan')?.correctOptionId).toBe('japan');
    expect(byId('right-penguin')?.correctOptionId).toBe('penguin');
    expect(byId('place-eiffel')?.correctOptionId).toBe('france');
    expect(byId('place-brazil-flag')?.correctOptionId).toBe('brazil');
    expect(byId('place-canada-reverse')?.correctOptionId).toBe('canada');
  });

  it('no round repeats its hero image among the answer options (no picture-matching the hero)', () => {
    for (const g of allGames) {
      if (!g.visual.heroArt) continue;
      for (const o of [...(g.options ?? []), ...(g.items ?? [])]) {
        expect(o.art, `${g.id}/${o.id} repeats the hero`).not.toBe(g.visual.heroArt);
      }
    }
    // The reported instance: Brazil's flag is the hero, so its options are country-name cards, no flag art.
    const brazil = byId('place-brazil-flag')!;
    expect(brazil.visual.heroArt).toBe('flag-br');
    expect(brazil.options!.every((o) => o.art === undefined)).toBe(true);
    expect(brazil.options!.map((o) => o.text)).toEqual(['Argentina', 'Mexico', 'Brazil', 'Portugal']);
  });

  it('art and alt come as a pair on every pictured choice', () => {
    for (const g of allGames) {
      for (const o of [...(g.options ?? []), ...(g.items ?? [])]) {
        expect(Boolean(o.art), `${g.id}/${o.id} art/alt pairing`).toBe(Boolean(o.alt));
        if (o.art) expect(o.alt!.length, `${g.id}/${o.id} alt`).toBeGreaterThan(5);
      }
    }
  });

  it('odd-one-out games offer exactly four pictured items', () => {
    for (const g of allGames.filter((x) => x.gameType === 'odd-one-out')) {
      expect(g.items, g.id).toHaveLength(4);
      expect(g.items!.every((o) => o.art)).toBe(true);
    }
  });
});

describe('games in the regular question flow', () => {
  it('the keep-playing pool merges games with quizzes and is built for both kinds', () => {
    expect(playPanelSrc).toContain("listPublic(db, viewer.scope, { kind: 'game'");
    expect(playPanelSrc).toContain("item.kind === 'quiz' || item.kind === 'game'");
  });

  it('scene games render their scene inside the play form; memory games hide it at the answer step', () => {
    expect(playFormSrc).toContain('<SceneView');
    expect(playFormSrc).toContain("gameType === 'memory' && stage !== 'answer'");
    expect(playFormSrc).toContain('?stage=answer#play-panel');
    expect(playFormSrc).toContain('The picture is hidden now');
  });
});

// Phase discipline (owner design review, 18 Nov 2026): a game whose mechanic is remembering must
// never leak what is to be remembered — or the question itself — before the ask phase. Memory used
// to head its look phase with the actual question ("how many frogs…"), sequence recall showed the
// whole strip numbered, with the question and options on the same screen, and what-changed showed
// both pictures side-by-side. These renders pin the separated phases.
describe('phase discipline: show first, ask after', () => {
  const scene = {
    template: 'beach',
    elements: [
      { id: 'frog-1', art: 'frog', name: 'frog', color: 'green' as const, x: 200, y: 480 },
      { id: 'crab-1', art: 'crab', name: 'crab', color: 'red' as const, x: 420, y: 500 },
    ],
  };
  const choices = [
    { id: 'a', text: 'green frog' },
    { id: 'b', text: 'pink cupcake' },
    { id: 'c', text: 'purple cupcake' },
    { id: 'd', text: 'yellow kite' },
  ];
  const base: PlayView = { mechanic: 'multiple_choice', prompt: '', options: choices, items: [], clues: [], difficulty: 'easy' };
  const render = (play: PlayView, extra: { stage?: 'look' | 'answer'; step?: number } = {}) =>
    renderToStaticMarkup(createElement(PlayForm, { action: '/play/fx/', play, clues: 0, ...extra }));
  const sceneCount = (html: string) => html.split('scene-view').length - 1;

  const MEMORY_PROMPT = 'From memory: how many frogs are in the beach?';
  const memoryPlay: PlayView = {
    ...base,
    prompt: MEMORY_PROMPT,
    visual: { gameType: 'memory', scene, sceneAlt: 'A beach scene. In the scene: green frog, red crab.', sequence: [] },
  };

  it('memory look phase shows the scene and a neutral instruction — never the question', () => {
    const html = render(memoryPlay);
    expect(html).not.toContain(MEMORY_PROMPT);
    expect(html).not.toContain('how many frogs');
    expect(html).toContain('Look carefully — remember everything you see.');
    expect(html).toContain('scene-view');
    expect(html).toContain('?stage=answer#play-panel');
    expect(html).not.toContain('type="radio"');
  });

  it('memory answer phase shows the question with the picture gone', () => {
    const html = render(memoryPlay, { stage: 'answer' });
    expect(html).toContain(MEMORY_PROMPT);
    expect(html).not.toContain('scene-view');
    expect(html).toContain('type="radio"');
  });

  const SEQ_PROMPT = 'Spark showed some things in order. What came first?';
  const sequencePlay: PlayView = {
    ...base,
    prompt: SEQ_PROMPT,
    visual: {
      gameType: 'sequence',
      sequence: [
        { art: 'duck', label: 'yellow duck', color: 'yellow' as const },
        { art: 'rocket', label: 'red rocket', color: 'red' as const },
        { art: 'apple', label: 'green apple', color: 'green' as const },
      ],
      askPosition: 1,
    },
  };

  it('sequence show phase reveals one item at a time — no question, no options, no number badges', () => {
    const step0 = render(sequencePlay, { step: 0 });
    expect(step0).not.toContain(SEQ_PROMPT);
    expect(step0).not.toContain('type="radio"');
    expect(step0).not.toContain('seq-num');
    expect(step0).toContain('thing 1 of 3');
    expect(step0).toContain('?step=1#play-panel');
    const step2 = render(sequencePlay, { step: 2 });
    expect(step2).toContain('thing 3 of 3');
    expect(step2).toContain('?stage=answer#play-panel');
    expect(step2).not.toContain(SEQ_PROMPT);
  });

  it('sequence answer phase shows the question and options with the items hidden', () => {
    const html = render(sequencePlay, { stage: 'answer' });
    expect(html).toContain(SEQ_PROMPT);
    expect(html).toContain('type="radio"');
    expect(html).not.toContain('seq-stage');
    expect(html).not.toContain('seq-art');
  });

  const CHANGED_PROMPT = 'One thing changed between the before and after pictures. What changed?';
  const changedPlay: PlayView = {
    ...base,
    prompt: CHANGED_PROMPT,
    visual: {
      gameType: 'what-changed',
      scene,
      sceneAlt: 'A beach scene. In the scene: green frog, red crab.',
      sceneAfter: { ...scene, elements: scene.elements.slice(0, 1) },
      sceneAfterAlt: 'A beach scene. In the scene: green frog.',
      sequence: [],
    },
  };

  it('what-changed shows the before picture alone first, then the after picture with the question', () => {
    const look = render(changedPlay);
    expect(sceneCount(look)).toBe(1);
    expect(look).toContain('Before');
    expect(look).not.toContain(CHANGED_PROMPT);
    expect(look).not.toContain('type="radio"');
    expect(look).toContain('?stage=answer#play-panel');
    const answer = render(changedPlay, { stage: 'answer' });
    expect(sceneCount(answer)).toBe(1);
    expect(answer).toContain('After');
    expect(answer).toContain(CHANGED_PROMPT);
    expect(answer).toContain('type="radio"');
  });

  it('spot-the-difference still shows both pictures together with the question', () => {
    const diffPlay: PlayView = {
      ...changedPlay,
      prompt: 'Three things changed between the two pictures. Which list names all three changes?',
      visual: { ...changedPlay.visual!, gameType: 'spot-difference' },
    };
    const html = render(diffPlay);
    expect(sceneCount(html)).toBe(2);
    expect(html).toContain('Three things changed');
    expect(html).toContain('type="radio"');
  });
});

describe("Spark's recorded voice (owner lines, 18 Nov 2026)", () => {
  it('every clip in the voice map exists in public/brand', () => {
    for (const src of Object.values(SPARK_VOICE)) {
      expect(existsSync(`${process.cwd()}/public${src}`), src).toBe(true);
    }
    expect(SPARK_VOICE.greeting).toBe('/brand/spark-hi-friends.mp3');
    expect(SPARK_VOICE.praise).toBe('/brand/spark-great-listening.mp3');
    expect(SPARK_VOICE.completion).toBe('/brand/spark-you-did-it.mp3');
    expect(SPARK_VOICE.encouragement).toBe('/brand/spark-try-again.mp3');
    expect(SPARK_VOICE.goodbye).toBe('/brand/spark-goodbye.mp3');
  });

  it('the play island plays praise, encouragement and completion only from the answer submission', () => {
    expect(enhancerSrc).toContain("playSparkVoice(imported.querySelector('.kp-done') ? 'completion' : 'praise')");
    expect(enhancerSrc).toContain("playSparkVoice('encouragement')");
    expect(enhancerSrc).not.toContain('autoPlay');
  });

  it('the assistant greets by tap-to-play and says goodbye on the dismissal tap', () => {
    expect(assistantSrc).toContain('src={SPARK_VOICE.greeting}');
    expect(assistantSrc).toContain("playSparkVoice('goodbye')");
    expect(assistantSrc).not.toContain('autoPlay');
  });

  it('the sound toggle is visible, default-on and persisted under the shared key', () => {
    expect(toggleSrc).toContain('aria-pressed={on}');
    expect(toggleSrc).toContain('SPARK_SOUND_KEY');
    expect(toggleSrc).toContain("localStorage.setItem(SPARK_SOUND_KEY, was ? 'off' : 'on')");
  });
});
