import {createHash} from 'node:crypto';
import {z} from 'zod';
import {dateSchema} from './schemas';

export function contentFingerprint(value: unknown): string {
  function stable(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)]));
    return v;
  }
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export const approvalRecordSchema=z.object({
  approvedBy:z.string().min(1),approvedAt:dateSchema,
  authorization:z.string().min(1),
  entries:z.array(z.object({kind:z.enum(['article','quiz']),id:z.string(),priorHash:z.string().length(64),approvedHash:z.string().length(64),fields:z.record(z.string(),z.unknown())})).min(24)
});
export const launchApprovalSchema=z.object({
  approvedBy:z.string().min(1),approvedAt:dateSchema,
  decision:z.enum(['fully-reviewed-release','owner-directed-public-launch']),
  authorization:z.string().min(1),
  editorialApprovalFile:z.literal('docs/editorial-approval.json'),
  outstandingReviews:z.array(z.object({area:z.enum(['media-rights','hosting-privacy','child-privacy','contact-channel']),status:z.literal('not-independently-verified'),note:z.string().min(1)})),
  ownerDirectedPublicationWithDisclosedOutstandingReviews:z.boolean()
}).superRefine((a,c)=>{
  if(a.outstandingReviews.length && (a.decision!=='owner-directed-public-launch' || !a.ownerDirectedPublicationWithDisclosedOutstandingReviews))c.addIssue({code:'custom',message:'Outstanding reviews require a recorded explicit owner-directed publication decision'});
});
