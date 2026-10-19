import {describe,it,expect} from 'vitest';
import {articleSchema,quizSchema,dateSchema,assertUnique} from '../../lib/schemas';
import {allArticles,allQuizzes,getArticle} from '../../lib/content';
import {selectQuiz,utcDate,millisecondsToMidnight} from '../../lib/quiz-date';
import {isBrand} from '../../lib/config';
describe('content safety and schemas',()=>{
 it('provides ten substantive owner-approved entries and fourteen dated questions',()=>{expect(allArticles).toHaveLength(10);expect(allQuizzes).toHaveLength(14);for(const a of allArticles){expect(a.body.flatMap(s=>s.paragraphs).join(' ').split(/\s+/).length).toBeGreaterThan(150);expect(a.reviewStatus).toBe('approved');}});
 it('rejects unknown brands and slugs',()=>{expect(isBrand('constructor')).toBe(false);expect(getArticle('unknown','x')).toBeUndefined();expect(getArticle('kids','unknown')).toBeUndefined();expect(articleSchema.safeParse({...allArticles[0],brand:'unknown'}).success).toBe(false);});
 it('rejects impossible dates and allows leap day',()=>{expect(dateSchema.safeParse('2028-02-29').success).toBe(true);expect(dateSchema.safeParse('2026-02-29').success).toBe(false);expect(dateSchema.safeParse('2026-13-01').success).toBe(false);});
 it('rejects duplicate IDs, dates, options, and invalid answer references',()=>{expect(()=>assertUnique([allQuizzes[0],allQuizzes[0]])).toThrow('Duplicate id');expect(()=>assertUnique([allQuizzes[0],{...allQuizzes[1],scheduledDate:allQuizzes[0].scheduledDate}])).toThrow('Duplicate scheduledDate');expect(quizSchema.safeParse({...allQuizzes[0],correctOptionId:'z'}).success).toBe(false);expect(quizSchema.safeParse({...allQuizzes[0],options:[allQuizzes[0].options[0],...allQuizzes[0].options.slice(0,3)]}).success).toBe(false);expect(quizSchema.safeParse({...allQuizzes[0],explanation:''}).success).toBe(false);});
 it('requires human identity for approval and child safety fields',()=>{expect(articleSchema.safeParse({...allArticles[0],reviewStatus:'approved',reviewer:null}).success).toBe(false);const kids=allArticles.find(a=>a.brand==='kids')!;expect(articleSchema.safeParse({...kids,ageGuidance:undefined}).success).toBe(false);expect(quizSchema.safeParse({...allQuizzes[0],reviewStatus:'approved',reviewer:null}).success).toBe(false);});
});
describe('UTC schedule',()=>{
 it('selects by UTC rather than local day and rolls over at midnight',()=>{expect(utcDate(new Date('2026-10-17T20:00:00-04:00'))).toBe('2026-10-18');expect(selectQuiz(allQuizzes,new Date('2026-10-17T23:59:59.999Z')).current?.id).toBe('number-detective-001');expect(millisecondsToMidnight(new Date('2026-10-17T23:59:59.999Z'))).toBe(1);expect(selectQuiz(allQuizzes,new Date('2026-10-18T00:00:00Z')).current?.id).toBe('word-clues-002');});
 it('does not silently recycle an exhausted or future schedule',()=>{const result=selectQuiz(allQuizzes,new Date('2027-01-01T00:00:00Z'));expect(result.current).toBeUndefined();expect(result.latest?.scheduledDate).toBe('2026-10-30');expect(selectQuiz(allQuizzes,new Date('2026-10-01T00:00:00Z')).latest).toBeUndefined();});
 it('computes leap-day midnight',()=>{expect(millisecondsToMidnight(new Date('2028-02-29T12:00:00Z'))).toBe(43200000);expect(utcDate(new Date('2028-03-01T00:00:00Z'))).toBe('2028-03-01');});
});
