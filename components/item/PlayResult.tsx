import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PlayResult as Result } from '@/lib/play/answer';

type Props = {
  result: Exclude<Result, { status: 'not_found' }>;
  again: string;
  another: string;
  invalidHint?: string;
  // The "keep playing" block (quizzes only, built by PlayPanel): when present it carries the primary
  // next-step actions, and the archive link is demoted to a quiet "Browse all questions".
  keepPlaying?: ReactNode;
};

// The outcome of one submitted response, rendered on the server. The explanation exists only in this block, which is
// only produced after a response has been checked.
// The block is the target of the form's #result fragment and is focusable, so a keyboard or screen-reader user lands on
// the verdict after submitting.
export default function PlayResult({ result, again, another, invalidHint, keepPlaying }: Props) {
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
        <p>
          <strong>Answer: {result.answerText}</strong>
        </p>
        <p>{result.explanation}</p>
      </div>
      {keepPlaying ? (
        <>
          {keepPlaying}
          <p>
            <Link className="text-button" href={again}>
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
          <Link className="text-button" href={again}>
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
