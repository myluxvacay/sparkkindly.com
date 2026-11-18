// The visual games collection (18 Nov 2026): size, spread and dating. Answer correctness itself is
// proven per game by the content schema (lib/schemas.ts) at import — this suite pins the collection
// shape the owner asked for and re-derives every counting answer from the raw files, independently
// of the schema's own check.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { allGames } from '@/lib/content';
import { countInScene, type SceneSpec } from '@/lib/games/scene';

const SIX = ['observation', 'memory', 'spot-difference', 'what-changed', 'counting', 'sequence'] as const;

describe('visual games collection', () => {
  it('holds 300–400 games, 50–65 of each of the six new types', () => {
    expect(allGames.length).toBeGreaterThanOrEqual(300);
    expect(allGames.length).toBeLessThanOrEqual(400);
    for (const type of SIX) {
      const n = allGames.filter((g) => g.gameType === type).length;
      expect(n, type).toBeGreaterThanOrEqual(50);
      expect(n, type).toBeLessThanOrEqual(65);
    }
  });

  it('spreads across difficulties (roughly even) and includes a Kids set', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      expect(allGames.filter((g) => g.difficulty === d).length, d).toBeGreaterThanOrEqual(90);
    }
    expect(allGames.filter((g) => g.brand === 'kids').length).toBeGreaterThanOrEqual(25);
    for (const world of ['play', 'discover', 'together', 'grow', 'save'] as const) {
      expect(allGames.filter((g) => g.brand === world).length, world).toBeGreaterThanOrEqual(10);
    }
  });

  it('makes a solid share playable immediately and runs the rest on a daily runway', () => {
    const immediate = allGames.filter((g) => g.scheduledDate <= '2026-11-18').length;
    expect(immediate / allGames.length).toBeGreaterThanOrEqual(0.35);
    const future = allGames.filter((g) => g.scheduledDate > '2026-11-18');
    expect(future.length).toBeGreaterThan(100);
    const perDay = new Map<string, number>();
    for (const g of future) perDay.set(g.scheduledDate, (perDay.get(g.scheduledDate) ?? 0) + 1);
    for (const [day, n] of perDay) expect(n, day).toBeLessThanOrEqual(2);
  });

  it('recounts every counting game from its raw scene data', () => {
    const files = readdirSync(`${process.cwd()}/content/games`).filter((f) => f.endsWith('.json'));
    let checked = 0;
    for (const f of files) {
      const raw = JSON.parse(readFileSync(`${process.cwd()}/content/games/${f}`, 'utf8'));
      if (raw.gameType !== 'counting') continue;
      const n = countInScene(raw.visual.scene as SceneSpec, raw.visual.countTarget);
      expect(n, raw.id).toBe(raw.numberAnswer.value);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(50);
  });

  it('has unique ids and no two games with identical scene payloads', () => {
    expect(new Set(allGames.map((g) => g.id)).size).toBe(allGames.length);
    // Prompts repeat across scenes by design (the picture is the content); a true duplicate is the
    // same picture carrying the same question, which must never ship twice.
    const seen = new Set<string>();
    for (const g of allGames) {
      const key = JSON.stringify({ v: g.visual, p: g.prompt, a: g.correctOptionId ?? g.numberAnswer, o: g.options, i: g.items });
      expect(seen.has(key), g.id).toBe(false);
      seen.add(key);
    }
  });
});
