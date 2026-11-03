// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseGoals } from '@/lib/agents/goals';
import { parseVerdict } from '@/lib/agents/verdict';
import { itemSubmissionSchema, supportedKinds } from '@/lib/items/format';
import { topicChildren, topicParents, topicRoots } from '@/db/seed/topics';

const good = `---
slug: play
audience: all
maxItemsPerRun: 3
kinds: quiz, game
topics: number-puzzles, patterns
---
## Voice
Direct, warm, not preachy.

## Never
- medical advice
- real private people
`;

describe('parseGoals', () => {
  it('parses a valid goals file', () => {
    expect(parseGoals(good)).toMatchObject({
      slug: 'play',
      audience: 'all',
      maxItemsPerRun: 3,
      kinds: ['quiz', 'game'],
      topics: ['number-puzzles', 'patterns'],
      never: ['medical advice', 'real private people'],
    });
  });

  it.each([
    ['a missing slug', good.replace('slug: play\n', '')],
    ['more than 10 items per run', good.replace('maxItemsPerRun: 3', 'maxItemsPerRun: 11')],
    ['zero items per run', good.replace('maxItemsPerRun: 3', 'maxItemsPerRun: 0')],
    ['an unknown audience', good.replace('audience: all', 'audience: everyone')],
    ['an empty Never list', good.replace(/## Never[\s\S]*$/, '## Never\n')],
    ['no Never section', good.replace(/## Never[\s\S]*$/, '')],
    ['no front matter', good.replace(/^---[\s\S]*?---\n/, '')],
  ])('rejects %s', (_name, text) => {
    expect(() => parseGoals(text)).toThrow();
  });
});

describe('the goals files in agents/worlds', () => {
  const dir = path.join(__dirname, '../../agents/worlds');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const topics = new Set([...Object.keys(topicParents), ...Object.keys(topicRoots), ...Object.values(topicChildren).flatMap((c) => Object.keys(c))]);

  it('covers the five worlds', () => {
    expect(files.sort()).toEqual(['discover.md', 'grow.md', 'kids.md', 'play.md', 'together.md']);
  });

  it.each(['discover', 'grow', 'kids', 'play', 'together'])('%s parses and only names real kinds and topics', (slug) => {
    const g = parseGoals(readFileSync(path.join(dir, `${slug}.md`), 'utf8'));
    expect(g.slug).toBe(slug);
    for (const k of g.kinds) expect(supportedKinds as readonly string[]).toContain(k);
    for (const t of g.topics) expect(topics.has(t), `unknown topic ${t}`).toBe(true);
    expect(g.never.length).toBeGreaterThanOrEqual(5);
    if (slug === 'kids') expect(g.audience).toBe('kids');
    else expect(g.audience).not.toBe('kids');
  });
});

describe('parseVerdict', () => {
  it('parses a passing verdict with the sources it opened', () => {
    const v = parseVerdict({ pass: true, reasons: ['Sources support the claim'], sourcesChecked: ['https://example.test/a'] }, { tier: 'sourced' });
    expect(v.pass).toBe(true);
  });

  it('rejects a pass for a Sourced item that opened no source', () => {
    expect(() => parseVerdict({ pass: true, reasons: ['looks fine'], sourcesChecked: [] }, { tier: 'sourced' })).toThrow(/source/i);
  });

  it('rejects a pass for a Computable item with no independent answer', () => {
    expect(() => parseVerdict({ pass: true, reasons: ['ok'], sourcesChecked: [] }, { tier: 'computable' })).toThrow(/solved/i);
  });

  it('accepts a Computable pass that carries its own solved answer', () => {
    expect(parseVerdict({ pass: true, reasons: ['ok'], sourcesChecked: [], solvedAnswer: '30' }, { tier: 'computable' }).solvedAnswer).toBe('30');
  });

  it('requires a reason for every failure', () => {
    expect(() => parseVerdict({ pass: false, reasons: [], sourcesChecked: [] }, { tier: 'reflective' })).toThrow();
  });

  it('allows a Reflective pass with no sources', () => {
    expect(parseVerdict({ pass: true, reasons: ['Tone is fine'], sourcesChecked: [] }, { tier: 'reflective' }).pass).toBe(true);
  });
});

describe('the reviewer evaluation fixtures', () => {
  const dir = path.join(__dirname, '../../agents/fixtures/review');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

  it('covers a clean pass, a wrong answer, an unsupported claim, a duplicate and an injected instruction', () => {
    expect(files).toHaveLength(5);
  });

  it.each(files)('%s is a valid submission with a label and a tier', (file) => {
    const f = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    expect(['pass', 'fail']).toContain(f.expect);
    expect(['sourced', 'computable', 'reflective', 'kids']).toContain(f.tier);
    expect(itemSubmissionSchema.safeParse(f.item).success, file).toBe(true);
    expect(Array.isArray(f.recentTitles)).toBe(true);
  });
});
