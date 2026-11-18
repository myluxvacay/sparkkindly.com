import fs from 'node:fs';
import {readFolder} from './repository';
import { articleSchema, quizSchema, gameSchema, assertUnique, type Article } from './schemas';
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
// Visual games (18 Nov 2026) are repo-folder content in both modes: they are not part of the legacy
// snapshot. IDs must be unique; dates are shared by design (several games may land on one day), so
// the assertUnique scheduledDate rule for quizzes does not apply here.
export const allGames=readFolder('games').map(g=>gameSchema.parse(g)).sort((a,b)=>a.scheduledDate.localeCompare(b.scheduledDate));
if(new Set(allGames.map(g=>g.id)).size!==allGames.length) throw new Error('Duplicate game id');
export const games=allGames.filter(g=>!site.published || g.reviewStatus==='approved');
export function getArticle(brand:string,slug:string) { return isBrand(brand) ? articles.find(a=>a.brand===brand && a.slug===slug) : undefined; }
export const readingTime=(a:Article) => Math.max(1,Math.ceil(a.body.flatMap(b=>b.paragraphs).join(' ').split(/\s+/).length/200));
export const articlePath=(a:Article)=>`/${a.brand}/${a.slug}/`;
