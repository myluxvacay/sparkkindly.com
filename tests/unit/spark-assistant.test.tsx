// Spark assistant (#20, 17 Nov 2026): the owner's settled behaviour — no autoplay sound, tap-to-play voice,
// tour links to real routes, dismissal remembered. Static markup covers the no-JS/first-render contract
// (Spark stays hidden until the client checks localStorage); the source pins the behaviour that needs a DOM.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import SparkAssistant from '@/components/SparkAssistant';

const src = readFileSync(`${process.cwd()}/components/SparkAssistant.tsx`, 'utf8');

describe('SparkAssistant', () => {
  it('renders nothing before the dismissal check (a dismissed Spark never flashes)', () => {
    expect(renderToStaticMarkup(<SparkAssistant />)).toBe('');
  });

  it('never autoplays: audio is preload="none" with visitor-operated native controls', () => {
    expect(src).toContain('preload="none"');
    expect(src).not.toContain('autoPlay');
    expect(src).toContain('<audio ref={audioRef} controls');
    expect(src).toContain('Listen to Spark say hello');
  });

  it('tours only to real existing routes and remembers dismissal in localStorage', () => {
    for (const href of ['/quiz/', '/quiz/archive/', '/games/', '/#worlds']) expect(src).toContain(`href="${href}"`);
    expect(src).toContain("localStorage.getItem(DISMISS_KEY) === '1'");
    expect(src).toContain("localStorage.setItem(DISMISS_KEY, '1')");
  });

  it('uses the canonical cape Spark asset and carries the greeting as readable text (captions)', () => {
    expect(src).toContain('/brand/spark.webp');
    // The greeting clip is the owner's recorded hello (18 Nov 2026), named in the shared voice map;
    // its words appear beside the player, and Spark says the recorded goodbye on dismissal.
    expect(src).toContain('src={SPARK_VOICE.greeting}');
    expect(src).toContain('Hi friends, it’s Spark! Are you ready?');
    expect(src).toContain("playSparkVoice('goodbye')");
    expect(src).toContain('A warm and curious welcome to SparkKindly');
  });

  it('waves with the transparent GIF, and serves the still Spark to reduced-motion visitors', () => {
    expect(src).toContain('/brand/spark-waving.gif');
    expect(src).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    // The still is the reduced-motion branch, the GIF the default branch.
    expect(src).toMatch(/reducedMotion \? \([\s\S]*?\/brand\/spark\.webp/);
    expect(src).toMatch(/: \([\s\S]*?\/brand\/spark-waving\.gif/);
  });
});
