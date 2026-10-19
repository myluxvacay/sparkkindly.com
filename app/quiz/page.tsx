import Link from 'next/link';
import DailyQuiz from '@/components/Quiz';
import {quizzes} from '@/lib/content';
import {metadata as seo} from '@/lib/seo';
export const metadata=seo('Today’s quiz','One thoughtful daily question. No timers, accounts, or public scores.','/quiz/');
export default function QuizPage(){return <div className="container section quiz-page"><p className="eyebrow">THE DAILY SPARK</p><h1>A little pause.<br/>A fresh perspective.</h1><p>One question to stretch your thinking. Take your time.</p><div className="quiz-panel"><DailyQuiz quizzes={quizzes}/><noscript><p>Interactive checking needs JavaScript. All dated quizzes, explanations and answers are available in the <Link href="/quiz/archive/">quiz archive</Link>.</p></noscript></div><p><Link className="underlined" href="/quiz/archive/">Browse the dated quiz archive →</Link></p><p className="muted">Dates follow UTC worldwide. Answers are public educational content.</p></div>}
