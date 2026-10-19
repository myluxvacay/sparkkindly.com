import type { Quiz } from './schemas';
export const utcDate = (now: Date) => now.toISOString().slice(0,10);
export function millisecondsToMidnight(now:Date) { return Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)-now.getTime(); }
export function selectQuiz(quizzes:Quiz[],now:Date) {
 const today=utcDate(now);
 return {today, current:quizzes.find(q=>q.scheduledDate===today), latest:[...quizzes].filter(q=>q.scheduledDate<=today).sort((a,b)=>b.scheduledDate.localeCompare(a.scheduledDate))[0]};
}
export const formatDate = (date:string) => new Intl.DateTimeFormat('en',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
