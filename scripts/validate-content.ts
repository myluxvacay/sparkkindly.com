import fs from 'node:fs';
import {launchApprovalSchema,approvalRecordSchema,contentFingerprint} from '../lib/editorial-approval';
try {process.loadEnvFile('.env.local');} catch {}
const {allArticles,allQuizzes}=await import('../lib/content');
const {site}=await import('../lib/config');
for(const a of allArticles)if(!fs.existsSync(`public${a.hero.src}`))throw new Error(`Missing media for ${a.id}`);
if(allQuizzes.length<14 || allArticles.length<10)throw new Error('Require at least ten articles and fourteen quizzes');
if(site.published){
 if(!fs.existsSync('public/brand/sparkkindly-logo.svg') && !fs.existsSync('public/brand/sparkkindly-logo.png'))throw new Error('Release blocked: original logo missing');
 const launch=launchApprovalSchema.parse(JSON.parse(fs.readFileSync('docs/launch-approval.json','utf8')));
 const record=approvalRecordSchema.parse(JSON.parse(fs.readFileSync(launch.editorialApprovalFile,'utf8')));
 for(const [kind,entries] of [['article',allArticles],['quiz',allQuizzes]] as const){
  for(const entry of entries){
   if(entry.reviewStatus!=='approved')throw new Error(`Release blocked: ${entry.id} is not approved`);
   const approved=record.entries.find(e=>e.kind===kind && e.id===entry.id);
   if(!approved || approved.approvedHash!==contentFingerprint(entry))throw new Error(`Release blocked: ${entry.id} changed since owner approval`);
  }
 }
 if(launch.outstandingReviews.length)console.log(`Owner-directed publication: ${launch.outstandingReviews.length} independent review items remain disclosed in docs/launch-approval.json.`);
}
console.log(`Validated ${allArticles.length} articles and ${allQuizzes.length} quizzes. Mode: ${site.published?'owner-approved public release':'development preview'}.`);
