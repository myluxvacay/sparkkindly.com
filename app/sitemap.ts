import type {MetadataRoute} from 'next';
import {site,brands} from '@/lib/config';
import {articles,quizzes,articlePath} from '@/lib/content';
export const dynamic='force-static';
export default function sitemap():MetadataRoute.Sitemap {if(!site.published)return [];return ['/',...Object.keys(brands).map(b=>`/${b}/`),'/quiz/','/quiz/archive/','/about/','/privacy/','/editorial-policy/','/accessibility/','/contact/',...articles.filter(a=>a.reviewStatus==='approved').map(articlePath),...quizzes.filter(q=>q.reviewStatus==='approved').map(q=>`/quiz/${q.id}/`)].map(p=>({url:site.url+p}));}
