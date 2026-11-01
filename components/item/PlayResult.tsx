import Link from 'next/link';
import type { PlayResult as Result } from '@/lib/play/answer';

type Props = { result: Exclude<Result, { status: 'not_found' }>; again: string; another: string; invalidHint?: string };

// The outcome of one submitted response, rendered on the server. The explanation exists only in this block, which is
// only produced after a response has been checked.
// The block is the target of the form's #result fragment and is focusable, so a keyboard or screen-reader user lands on
// the verdict after submitting.
export default function PlayResult({ result, again, another, invalidHint }: Props) {
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
      <p>
        <Link className="button" href={another}>
          Try another <span aria-hidden="true">→</span>
        </Link>{' '}
        <Link className="text-button" href={again}>
          Try this one again ↺
        </Link>
      </p>
    </>
  );
}
