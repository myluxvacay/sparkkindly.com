import Link from 'next/link';
import {notFound} from 'next/navigation';
import {QuizForm} from '@/components/Quiz';
import {quizzes} from '@/lib/content';
import {formatDate} from '@/lib/quiz-date';
import {metadata as seo} from '@/lib/seo';
export const dynamicParams=false;
export function generateStaticParams(){return quizzes.map(q=>({id:q.id}));}
export async function generateMetadata({params}:{params:Promise<{id:string}>}){const {id}=await params;const q=quizzes.find(q=>q.id===id);return q?seo(`Quiz for ${formatDate(q.scheduledDate)}`,q.prompt,`/quiz/${id}/`):{};}
export default async function DatedQuiz({params}:{params:Promise<{id:string}>}){const {id}=await params;const q=quizzes.find(q=>q.id===id);if(!q)notFound();return <div className="container section quiz-page"><p><Link href="/quiz/archive/">← Quiz archive</Link></p><p className="eyebrow">A DATED DAILY SPARK</p><h1>Quiz for {formatDate(q.scheduledDate)}</h1><p>Scheduled date • UTC · {q.difficulty} · {q.reviewStatus==='approved'?`Reviewed by ${q.reviewer}`:'Development draft, human review pending'}</p><div className="quiz-panel"><QuizForm quiz={q}/></div><details className="answer-fallback"><summary>Read the answer and full explanation</summary><p><strong>{q.options.find(o=>o.id===q.correctOptionId)!.text}</strong></p><p>{q.explanation}</p></details>{q.sources.length>0&&<section><h2>Sources</h2><ul>{q.sources.map(s=><li key={s.url}><a href={s.url}>{s.title}</a></li>)}</ul></section>}<p>Nothing is recorded or shared. Reloading clears your answer.</p></div>}
