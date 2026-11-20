import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PlayResult as Result } from '@/lib/play/answer';

// The quiz context kept on screen with the verdict (user feedback, 17 Nov 2026): the question and the
// player's own answer, so the explanation reads as part of the quiz the player is still looking at,
// not as a page they were taken away to. Built by PlayPanel from the item's public view plus the
// checked result; the option list appears for the closed-choice mechanics, a one-line "your answer"
// for the rest.
export type PlayReview = {
  prompt: string;
  passage?: string;
  passageTitle?: string;
  passageImage?: { src?: string; alt: string };
  options?: { id: string; text: string; yours: boolean; correct: boolean }[];
  yourAnswer?: string;
};

type Props = {
  result: Exclude<Result, { status: 'not_found' }>;
  again: string;
  another: string;
  invalidHint?: string;
  review?: PlayReview;
  // The "keep playing" block (quizzes only, built by PlayPanel): when present it carries the primary
  // next-step actions, and the archive link is demoted to a quiet "Browse all questions".
  keepPlaying?: ReactNode;
};

// The outcome of one submitted response, rendered on the server. The explanation exists only in this block, which is
// only produced after a response has been checked.
// The block is the target of the form's #result fragment and is focusable, so a keyboard or screen-reader user lands on
// the verdict after submitting.
export default function PlayResult({ result, again, another, invalidHint, review, keepPlaying }: Props) {
  // Retrying this quiz is a play-intent arrival: land on the panel (#play-panel), not the page top.
  // Only the retry links carry the fragment — `again` itself stays the bare item URL, which the
  // result-card image/API paths below are built from.
  const againPlay = `${again}#play-panel`;
  if (result.status === 'invalid') {
    return (
      <div role="status" id="result" tabIndex={-1} className="quiz-result">
        <p>{invalidHint ?? 'Please choose or enter an answer first, then check it.'}</p>
      </div>
    );
  }
  return (
    <>
      <div role="status" id="result" tabIndex={-1} className="quiz-result">
        <h2>{result.correct ? 'Correct. Nicely reasoned!' : 'Not quite. A little discovery to take with you.'}</h2>
        {review && (
          <div className="quiz-review">
            {review.passage && (
              <section className="passage" aria-label={review.passageTitle ?? 'Reading passage'}>
                {review.passageImage?.src && <img className="passage-img" src={review.passageImage.src} alt={review.passageImage.alt} loading="lazy" />}
                {review.passageTitle && <h3 className="passage-title">{review.passageTitle}</h3>}
                {review.passage.split(/\n\s*\n/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </section>
            )}
            {review.prompt && <p className="quiz-review-prompt">{review.prompt}</p>}
            {review.options ? (
              <ul className="quiz-review-options">
                {review.options.map((o) => (
                  <li
                    key={o.id}
                    className={`quiz-review-option${o.yours ? ' is-yours' : ''}${o.correct ? ' is-correct' : ''}`}
                  >
                    <span>{o.text}</span>
                    {o.yours && o.correct && <span className="quiz-tag quiz-tag-yours">Your answer — the correct one</span>}
                    {o.yours && !o.correct && <span className="quiz-tag quiz-tag-yours">Your answer</span>}
                    {!o.yours && o.correct && <span className="quiz-tag quiz-tag-correct">Correct answer</span>}
                  </li>
                ))}
              </ul>
            ) : review.yourAnswer ? (
              <p className="quiz-review-yours">
                Your answer: <strong>{review.yourAnswer}</strong>
              </p>
            ) : null}
          </div>
        )}
        <div className="quiz-explain">
          <p>
            <strong>Answer: {result.answerText}</strong>
          </p>
          <p>{result.explanation}</p>
        </div>
      </div>
      {keepPlaying ? (
        <>
          {keepPlaying}
          <p>
            <Link className="text-button" href={againPlay}>
              Try this one again ↺
            </Link>{' '}
            <Link className="underlined" href={another}>
              Browse all questions
            </Link>
          </p>
        </>
      ) : (
        <p>
          <Link className="button" href={another}>
            Try another <span aria-hidden="true">→</span>
          </Link>{' '}
          <Link className="text-button" href={againPlay}>
            Try this one again ↺
          </Link>
        </p>
      )}
      <div className="result-card">
        <img src={`/api/result-card${again}`} alt="" width={150} height={188} loading="lazy" />
        <p>
          Your card for this one — save it or post it. It shows the question, never a score.{' '}
          <a href={`/api/result-card${again}`}>Open the full-size card ↗</a>
        </p>
      </div>
    </>
  );
}
