import Link from 'next/link';
import {quizzes} from '@/lib/content';
import {formatDate} from '@/lib/quiz-date';
import {metadata as seo} from '@/lib/seo';
export const metadata=seo('Quiz archive','Every scheduled SparkKindly quiz, clearly dated, with an accessible answer and explanation.','/quiz/archive/');
export default function Archive(){return <div className="container section"><p className="eyebrow">A SHELF OF LITTLE CHALLENGES</p><h1>The quiz archive</h1><p className="intro-text">Explore our dated collection. Scheduled dates are shown in UTC, including upcoming entries. There’s no clock to beat.</p><div className="archive-grid">{quizzes.map(q=><article key={q.id}><p className="eyebrow">{formatDate(q.scheduledDate)} UTC</p><h2><Link href={`/quiz/${q.id}/`}>{q.prompt}</Link></h2><p>{q.brand} · {q.difficulty}</p><Link href={`/quiz/${q.id}/`}>Try this question →</Link></article>)}</div>{!quizzes.length&&<p>Our first questions are still being checked. Please visit again soon.</p>}</div>}
