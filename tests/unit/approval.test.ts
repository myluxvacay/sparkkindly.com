import {describe,it,expect} from 'vitest';
import {contentFingerprint,launchApprovalSchema,approvalRecordSchema} from '../../lib/editorial-approval';
import record from '../../docs/editorial-approval.json';
import launch from '../../docs/launch-approval.json';
import {allArticles,allQuizzes} from '../../lib/content';
describe('owner publication approval',()=>{
 it('records the owner instruction without claiming independent reviews',()=>{
   expect(launchApprovalSchema.parse(launch).decision).toBe('owner-directed-public-launch');
   expect(launch.outstandingReviews).toHaveLength(4);
   expect(approvalRecordSchema.parse(record).entries).toHaveLength(24);
 });
 it('does not permit outstanding reviews under a fully-reviewed release claim',()=>{
   expect(launchApprovalSchema.safeParse({...launch,decision:'fully-reviewed-release'}).success).toBe(false);
   expect(launchApprovalSchema.safeParse({...launch,ownerDirectedPublicationWithDisclosedOutstandingReviews:false}).success).toBe(false);
 });
 it('ties every approval to the approved revision and detects edits',()=>{
   for(const [kind,entries] of [['article',allArticles],['quiz',allQuizzes]] as const){
     for(const e of entries){
       const approved=record.entries.find(a=>a.kind===kind&&a.id===e.id)!;
       expect(contentFingerprint(e)).toBe(approved.approvedHash);
       expect(approved.priorHash).not.toBe(approved.approvedHash);
       expect(contentFingerprint({...e,reviewNote:'changed'})).not.toBe(approved.approvedHash);
     }
   }
 });
 it('fingerprints objects independently of key insertion order',()=>{
   expect(contentFingerprint({a:1,b:{x:2,y:3}})).toBe(contentFingerprint({b:{y:3,x:2},a:1}));
 });
});
