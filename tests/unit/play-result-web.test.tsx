// Result panel kept context (user feedback, 17 Nov 2026): after an answer — a wrong one above all —
// the verdict used to replace the quiz outright, which felt like being taken away from it. The result
// now keeps the question and the player's own answer on screen, marks the correct option beside
// theirs, and puts the answer and explanation in a panel of their own inside the same result card.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PlayResult, { type PlayReview } from '@/components/item/PlayResult';
import type { PlayResult as Result } from '@/lib/play/answer';

const wrong: Extract<Result, { status: 'ok' }> = {
  status: 'ok',
  itemId: 'q1',
  correct: false,
  answerText: 'The Moon',
  explanation: 'Because of how sunlight falls on it.',
  choice: 'b',
  answerChoice: 'a',
};
const review: PlayReview = {
  prompt: 'What lights up the night sky?',
  options: [
    { id: 'a', text: 'The Moon', yours: false, correct: true },
    { id: 'b', text: 'A street lamp', yours: true, correct: false },
    { id: 'c', text: 'A firefly', yours: false, correct: false },
  ],
};

describe('PlayResult kept context', () => {
  it('a wrong answer keeps the question, marks your pick and the correct one, and panels the explanation', () => {
    const html = renderToStaticMarkup(<PlayResult result={wrong} again="/play/q1/" another="/quiz/archive/" review={review} />);
    expect(html).toContain('Not quite');
    expect(html).toContain('quiz-review');
    expect(html).toContain('What lights up the night sky?');
    expect(html).toContain('Your answer');
    expect(html).toContain('Correct answer');
    // The explanation sits in its own panel, with the answer stated inside it.
    expect(html).toContain('quiz-explain');
    expect(html).toMatch(/quiz-explain[\s\S]*Answer: The Moon[\s\S]*Because of how sunlight falls on it\./);
  });

  it('a correct answer marks the one option as yours and the correct one together', () => {
    const right: Extract<Result, { status: 'ok' }> = { ...wrong, correct: true, choice: 'a' };
    const r2: PlayReview = {
      prompt: review.prompt,
      options: review.options!.map((o) => ({ ...o, yours: o.id === 'a' })),
    };
    const html = renderToStaticMarkup(<PlayResult result={right} again="/play/q1/" another="/quiz/archive/" review={r2} />);
    expect(html).toContain('Correct. Nicely reasoned!');
    expect(html).toContain('Your answer — the correct one');
    expect(html).not.toContain('>Correct answer<');
  });

  it('a non-choice mechanic shows the one-line your-answer instead of an option list', () => {
    const num: Extract<Result, { status: 'ok' }> = { ...wrong, answerText: '42', choice: 41, answerChoice: 42 };
    const html = renderToStaticMarkup(
      <PlayResult result={num} again="/play/q2/" another="/quiz/archive/" review={{ prompt: 'How many?', yourAnswer: '41' }} />,
    );
    expect(html).toContain('Your answer:');
    expect(html).toContain('<strong>41</strong>');
    expect(html).not.toContain('quiz-review-options');
  });

  it('without a review the verdict and explanation still render as before', () => {
    const html = renderToStaticMarkup(<PlayResult result={wrong} again="/play/q1/" another="/quiz/archive/" />);
    expect(html).toContain('Answer: The Moon');
    expect(html).toContain('Because of how sunlight falls on it.');
    expect(html).not.toContain('quiz-review');
  });
});
