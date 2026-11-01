import { describe, it, expect } from 'vitest';
import { itemSubmissionSchema, splitAnswer, mechanics, supportedKinds } from '@/lib/items/format';

const base = {
  slug: 'a-good-slug',
  title: 'A good title',
  summary: 'A summary long enough to be useful.',
  audience: 'all',
  topics: ['physics'],
  sources: [{ title: 'Source', url: 'https://example.org/a', accessedAt: '2026-10-30' }],
  idempotencyKey: 'key-12345678',
};
const explanation = 'Because the explanation has to be long enough to teach something.';
const quiz = (body: Record<string, unknown>, answerValue: unknown, over: Record<string, unknown> = {}) => ({
  ...base,
  kind: 'quiz',
  body: { prompt: 'Which of these is the right one?', difficulty: 'easy', ...body },
  answer: { value: answerValue, explanation },
  ...over,
});
const ok = (v: unknown) => itemSubmissionSchema.safeParse(v).success;
const opts = (n = 4) => Array.from({ length: n }, (_, i) => ({ id: String.fromCharCode(97 + i), text: `Option ${i + 1}` }));
const article = (over: Record<string, unknown> = {}) => ({
  ...base,
  kind: 'article',
  body: {
    sections: [
      { heading: 'One', paragraphs: ['First paragraph.'] },
      { heading: 'Two', paragraphs: ['Second paragraph.'] },
    ],
    takeaway: 'Keep this in mind.',
  },
  ...over,
});

describe('multiple_choice', () => {
  it('accepts a valid multiple_choice quiz', () => {
    expect(ok(quiz({ mechanic: 'multiple_choice', options: opts() }, 'c'))).toBe(true);
  });
  it('rejects multiple_choice with a duplicate option text', () => {
    const o = opts();
    o[1].text = o[0].text;
    expect(ok(quiz({ mechanic: 'multiple_choice', options: o }, 'a'))).toBe(false);
  });
  it('rejects an answer that is not one of the options', () => {
    expect(ok(quiz({ mechanic: 'multiple_choice', options: opts() }, 'z'))).toBe(false);
  });
  it('rejects multiple_choice without exactly four options', () => {
    expect(ok(quiz({ mechanic: 'multiple_choice', options: opts(3) }, 'a'))).toBe(false);
  });
});

describe('the other mechanics', () => {
  it('accepts true_false with a boolean answer and rejects a string', () => {
    expect(ok(quiz({ mechanic: 'true_false' }, true))).toBe(true);
    expect(ok(quiz({ mechanic: 'true_false' }, 'true'))).toBe(false);
  });
  it('accepts short_text with accepted variants and rejects an empty list', () => {
    expect(ok(quiz({ mechanic: 'short_text' }, { accepted: ['paris', 'Paris'] }))).toBe(true);
    expect(ok(quiz({ mechanic: 'short_text' }, { accepted: [] }))).toBe(false);
  });
  it('accepts number with tolerance and rejects a negative tolerance', () => {
    expect(ok(quiz({ mechanic: 'number' }, { value: 30, tolerance: 0 }))).toBe(true);
    expect(ok(quiz({ mechanic: 'number' }, { value: 30, tolerance: -1 }))).toBe(false);
  });
  it('accepts odd_one_out whose answer is one of four items', () => {
    expect(ok(quiz({ mechanic: 'odd_one_out', items: opts() }, 'b'))).toBe(true);
    expect(ok(quiz({ mechanic: 'odd_one_out', items: opts() }, 'q'))).toBe(false);
  });
  it('accepts put_in_order with a permutation answer and rejects anything else', () => {
    const items = opts(4);
    expect(ok(quiz({ mechanic: 'put_in_order', items }, ['b', 'a', 'd', 'c']))).toBe(true);
    expect(ok(quiz({ mechanic: 'put_in_order', items }, ['a', 'a', 'b', 'c']))).toBe(false);
    expect(ok(quiz({ mechanic: 'put_in_order', items }, ['a', 'b', 'c']))).toBe(false);
  });
  it('accepts clue_reveal with three to six clues', () => {
    const clues = ['one', 'two', 'three', 'four'];
    expect(ok(quiz({ mechanic: 'clue_reveal', clues }, { accepted: ['echo'] }))).toBe(true);
    expect(ok(quiz({ mechanic: 'clue_reveal', clues: ['one', 'two'] }, { accepted: ['echo'] }))).toBe(false);
  });
  it('rejects an unknown mechanic', () => {
    expect(ok(quiz({ mechanic: 'crossword' }, 'a'))).toBe(false);
  });
  it('lists the seven launch mechanics', () => {
    expect([...mechanics]).toEqual(['multiple_choice', 'true_false', 'short_text', 'number', 'odd_one_out', 'put_in_order', 'clue_reveal']);
  });
});

describe('kinds', () => {
  it('accepts a valid article and rejects fewer than two sections', () => {
    expect(ok(article())).toBe(true);
    expect(ok(article({ body: { sections: [{ heading: 'One', paragraphs: ['x'] }], takeaway: 't' } }))).toBe(false);
  });
  it('accepts the Kids article safety fields', () => {
    const kids = article({
      audience: 'kids',
      body: {
        sections: [
          { heading: 'One', paragraphs: ['x'] },
          { heading: 'Two', paragraphs: ['y'] },
        ],
        takeaway: 't',
        ageGuidance: 'Ages 6–9, with an adult',
        materials: ['paper'],
        supervision: 'An adult stays close.',
        safetyNotes: ['No scissors.'],
        screenFreeExtension: 'Try it outside.',
      },
    });
    expect(ok(kids)).toBe(true);
  });
  it('accepts a video_script', () => {
    expect(
      ok({
        ...base,
        kind: 'video_script',
        body: {
          hook: 'Did you know?',
          beats: [
            { voiceover: 'a', onScreenText: 'A', visual: 'v1' },
            { voiceover: 'b', onScreenText: 'B', visual: 'v2' },
            { voiceover: 'c', onScreenText: 'C', visual: 'v3' },
          ],
          captions: 'Full caption text',
          hashtags: ['#science'],
        },
      }),
    ).toBe(true);
  });
  it('does not accept the puzzle kind yet', () => {
    expect(ok({ ...base, kind: 'puzzle', body: {} })).toBe(false);
    expect([...supportedKinds]).toEqual(['article', 'game', 'quiz', 'video_script']);
  });
});

describe('shared fields', () => {
  it('rejects a slug with capitals', () => {
    expect(ok(article({ slug: 'Bad-Slug' }))).toBe(false);
  });
  it('rejects a non-https source url', () => {
    expect(ok(article({ sources: [{ title: 's', url: 'http://example.org', accessedAt: '2026-10-30' }] }))).toBe(false);
  });
  it('rejects an unknown audience', () => {
    expect(ok(article({ audience: 'teens' }))).toBe(false);
  });
  it('requires an idempotency key', () => {
    const { idempotencyKey: _omit, ...rest } = article();
    expect(ok(rest)).toBe(false);
  });
});

describe('splitAnswer', () => {
  it('removes the answer from the body and returns it separately', () => {
    const parsed = itemSubmissionSchema.parse(quiz({ mechanic: 'multiple_choice', options: opts() }, 'c'));
    const { body, answer } = splitAnswer(parsed);
    expect(JSON.stringify(body)).not.toMatch(/"answer"|"value"/);
    expect(answer).toEqual({ value: 'c', explanation });
  });
  it('drops an answer smuggled inside the quiz body', () => {
    const parsed = itemSubmissionSchema.parse(quiz({ mechanic: 'multiple_choice', options: opts(), answer: 'c', correct: 'c' }, 'c'));
    expect(JSON.stringify(splitAnswer(parsed).body)).not.toMatch(/"answer"|"correct"/);
  });
  it('returns no answer for an article', () => {
    expect(splitAnswer(itemSubmissionSchema.parse(article())).answer).toBeNull();
  });
});

describe('image.src stays on our own site', () => {
  const withSrc = (src: string) => article({ image: { origin: 'stock', licence: 'cc0', alt: 'A picture', src } });
  it('refuses any absolute, protocol-relative or odd URL, so visitors never fetch a third-party image', () => {
    for (const src of ['http://tracker.example/p.gif?u=1', 'https://cdn.example/p.png', '//cdn.example/p.png', 'javascript:alert(1)', '/a b']) {
      expect(ok(withSrc(src)), src).toBe(false);
    }
  });
  it('accepts a site-relative path or no src', () => {
    expect(ok(withSrc('/media/stock/a-photo.jpg'))).toBe(true);
    expect(ok(article({ image: { origin: 'template', licence: 'own', alt: 'A picture' } }))).toBe(true);
  });
});
