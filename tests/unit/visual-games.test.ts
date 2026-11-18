// Visual picture games: the starter rounds from 17 Nov 2026 (owner #21) plus the 18 Nov 2026
// collection. The siloed /games/ player was retired by owner direction (18 Nov 2026) — the rounds
// now live as library content in the regular question flow — so the guarantees that test pinned
// (verified answers, the hero rule, art/alt pairing, voice only on the player's own action, behind
// the persisted toggle) are pinned here against the new surfaces that carry them.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { allGames } from '@/lib/content';
import { SPARK_VOICE } from '@/lib/games/spark-voice';

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
    expect(playFormSrc).toContain("play.visual?.gameType === 'memory'");
    expect(playFormSrc).toContain('?stage=answer#play-panel');
    expect(playFormSrc).toContain('The picture is hidden now');
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
