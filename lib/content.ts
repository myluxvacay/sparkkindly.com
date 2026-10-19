import fs from 'node:fs';
import {readFolder} from './repository';
import { articleSchema, quizSchema, assertUnique, type Article } from './schemas';
import { site, isBrand } from './config';

function readContent() {
 if(process.env.CONTENT_SOURCE==='mongodb') {
  const snapshot=JSON.parse(fs.readFileSync('content/mongodb.snapshot.json','utf8'));
  return {articles:articleSchema.array().parse(snapshot.articles),quizzes:quizSchema.array().parse(snapshot.quizzes)};
 }
 return { articles:readFolder('articles').map(a=>articleSchema.parse(a)), quizzes:readFolder('quizzes').map(q=>quizSchema.parse(q)) };
}
const data=readContent();
assertUnique(data.articles); assertUnique(data.quizzes);
export const allArticles=data.articles;
export const allQuizzes=data.quizzes.sort((a,b)=>a.scheduledDate.localeCompare(b.scheduledDate));
export const articles=allArticles.filter(a=>!site.published || a.reviewStatus==='approved');
export const quizzes=allQuizzes.filter(q=>!site.published || q.reviewStatus==='approved');
export function getArticle(brand:string,slug:string) { return isBrand(brand) ? articles.find(a=>a.brand===brand && a.slug===slug) : undefined; }
export const readingTime=(a:Article) => Math.max(1,Math.ceil(a.body.flatMap(b=>b.paragraphs).join(' ').split(/\s+/).length/200));
export const articlePath=(a:Article)=>`/${a.brand}/${a.slug}/`;
