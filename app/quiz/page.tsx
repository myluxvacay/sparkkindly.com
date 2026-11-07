import Link from 'next/link';
import MoneyDisclaimer, { showsMoneyDisclaimer } from '@/components/item/MoneyDisclaimer';
import PlayPanel from '@/components/item/PlayPanel';
import ShareButtons from '@/components/item/ShareButtons';
import { isChildScope } from '@/lib/public/share';
import { getDb } from '@/lib/db';
import type { SearchParams } from '@/lib/public/play-params';
import { latestQuiz } from '@/lib/public/reads';
import { currentScope } from '@/lib/accounts/scope-next';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';

const TITLE = 'Today’s quiz';
const BLURB = 'One thoughtful daily question. No timers, accounts, or public scores.';

export async function generateMetadata() {
  const quiz = await latestQuiz(getDb(), await currentScope());
  // The quiz's own page is the canonical home of the question, so /quiz/ never competes with it.
  return seo(TITLE, BLURB, quiz ? `/${quiz.world}/${quiz.slug}/` : '/quiz/');
}

export default async function QuizPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const scope = await currentScope();
  const quiz = await latestQuiz(getDb(), scope);
  return (
    <div className="container section quiz-page">
      <p className="eyebrow">THE DAILY SPARK</p>
      <h1>A little pause.<br />A fresh perspective.</h1>
      <p>One question to stretch your thinking. Take your time.</p>
      {quiz ? (
        <>
          {showsMoneyDisclaimer(quiz.world) && <MoneyDisclaimer />}
          <PlayPanel item={quiz} searchParams={await searchParams} />
          <ShareButtons item={quiz} childContext={isChildScope(scope)} />
        </>
      ) : (
        <div className="quiz-panel">
          <h2>No new quiz today</h2>
          <p>Our next little challenge is still on its way.</p>
        </div>
      )}
      <p><Link className="underlined" href="/quiz/archive/">Browse the quiz archive →</Link></p>
      <p className="muted">Answers are public educational content.</p>
    </div>
  );
}
