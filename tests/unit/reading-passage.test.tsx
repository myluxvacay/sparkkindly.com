// Reading strand (20 Nov 2026): a passage-set question carries its passage in the item body, and
// the passage stays on screen both while the reader answers (PlayForm) and in the kept context
// after the verdict (PlayResult) — comprehension questions are answered FROM the text, so the
// text must never be taken away.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PlayForm from '@/components/item/PlayForm';
import PlayResult, { type PlayReview } from '@/components/item/PlayResult';
import { readPlay } from '@/lib/public/body';
import { quizSchema } from '@/lib/schemas';
import type { PlayResult as Result } from '@/lib/play/answer';

const PASSAGE = 'Ruby the fox dug her den under the roots of an old oak tree. She carried in dry leaves and soft moss to make a bed. That night, snow covered the forest, but inside her den Ruby was snug and warm.';

const play = readPlay({
  mechanic: 'multiple_choice',
  passage: PASSAGE,
  passageTitle: "The Fox's Winter Den",
  setId: 'reading-set-fox-winter-den',
  prompt: 'Where did Ruby make her den?',
  options: [
    { id: 'a', text: 'Under the roots of an old oak tree' },
    { id: 'b', text: 'Inside a hollow log' },
  ],
  difficulty: 'medium',
});

describe('reading passage in the play view', () => {
  it('readPlay keeps the passage, its title and the set id', () => {
    expect(play.passage).toBe(PASSAGE);
    expect(play.passageTitle).toBe("The Fox's Winter Den");
    expect(play.setId).toBe('reading-set-fox-winter-den');
  });

  it('the answer form shows the passage before the question options', () => {
    const html = renderToStaticMarkup(createElement(PlayForm, { action: '/kids/reading-fox-winter-den-q1/', play, clues: 0 }));
    expect(html).toContain('class="passage"');
    expect(html).toContain('Ruby the fox dug her den');
    expect(html.indexOf('Ruby the fox dug her den')).toBeLessThan(html.indexOf('Under the roots of an old oak tree'));
    expect(html).toContain('it stays here while you think');
  });

  it('the result review keeps the passage with the verdict', () => {
    const result: Extract<Result, { status: 'ok' }> = {
      status: 'ok', itemId: 'q1', correct: true, answerText: 'Under the roots of an old oak tree',
      explanation: 'The passage says Ruby found a hole under the roots of an old oak tree.', choice: 'a', answerChoice: 'a',
    };
    const review: PlayReview = {
      prompt: play.prompt, passage: play.passage, passageTitle: play.passageTitle,
      options: [
        { id: 'a', text: 'Under the roots of an old oak tree', yours: true, correct: true },
        { id: 'b', text: 'Inside a hollow log', yours: false, correct: false },
      ],
    };
    const html = renderToStaticMarkup(<PlayResult result={result} again="/kids/reading-fox-winter-den-q1/" another="/quiz/archive/" review={review} />);
    expect(html).toContain('Ruby the fox dug her den');
    expect(html.indexOf('Ruby the fox dug her den')).toBeLessThan(html.indexOf('Where did Ruby make her den?'));
  });

  it('a plain quiz without a passage renders no passage block', () => {
    const plain = readPlay({ mechanic: 'multiple_choice', prompt: 'What is 2 + 2?', options: [{ id: 'a', text: '4' }] });
    const html = renderToStaticMarkup(createElement(PlayForm, { action: '/play/x/', play: plain, clues: 0 }));
    expect(html).not.toContain('class="passage"');
  });

  it('the quiz schema accepts a passage set question and rejects a stub passage', () => {
    const base = {
      id: 'reading-test-q1', scheduledDate: '2027-04-24', brand: 'kids' as const,
      prompt: 'Where did Ruby make her den?',
      options: [
        { id: 'a', text: 'Under the roots of an old oak tree' }, { id: 'b', text: 'Inside a hollow log' },
        { id: 'c', text: 'On a hill' }, { id: 'd', text: 'In a wall' },
      ],
      correctOptionId: 'a', explanation: 'The passage says the den was under the roots of an old oak tree.',
      difficulty: 'medium' as const, sources: [], reviewStatus: 'draft' as const, reviewer: null, reviewedAt: null,
    };
    expect(quizSchema.parse({ ...base, passage: PASSAGE, passageTitle: "The Fox's Winter Den", setId: 'reading-set-fox-winter-den' }).setId).toBe('reading-set-fox-winter-den');
    expect(() => quizSchema.parse({ ...base, passage: 'Too short.' })).toThrow();
  });
});
