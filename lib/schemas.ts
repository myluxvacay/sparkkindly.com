import { z } from 'zod';
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Invalid calendar date');
export const brandSchema = z.enum(['play','discover','together','grow','kids']);
const sourceSchema = z.object({title:z.string().min(1),url:z.url().startsWith('https://'),accessedAt:dateSchema});
const review = { reviewStatus:z.enum(['draft','source-check','safety-review','approved']), reviewer:z.string().nullable(), reviewedAt:dateSchema.nullable(), reviewNote:z.string().optional() };
const media = z.object({src:z.string().startsWith('/images/'),alt:z.string(),width:z.number().positive(),height:z.number().positive(),credit:z.string().min(1),rights:z.string().min(1)});
export const articleSchema = z.object({id:z.string().min(1),slug:z.string().regex(/^[a-z0-9-]+$/),brand:brandSchema,contentType:z.enum(['article','video','activity']),title:z.string().min(1),description:z.string().min(1),publishedAt:dateSchema.nullable(),updatedAt:dateSchema,author:z.string().min(1),...review,ageGuidance:z.string().optional(),hero:media,tags:z.array(z.string()),sources:z.array(sourceSchema),factualClaimsReviewedAt:dateSchema.nullable(),aiDisclosure:z.string().min(1),body:z.array(z.object({heading:z.string().min(1),paragraphs:z.array(z.string().min(1)).min(1)})).min(2),takeaway:z.string().min(1),fiction:z.boolean().default(false),correctionNote:z.string().optional(),materials:z.array(z.string()).optional(),supervision:z.string().optional(),safetyNotes:z.array(z.string()).optional(),screenFreeExtension:z.string().optional(),productionStatus:z.enum(['in-production','available']).optional(),durationSeconds:z.number().positive().nullable().optional(),poster:media.optional(),videoSrc:z.string().nullable().optional(),captionsSrc:z.string().nullable().optional(),transcript:z.string().optional()}).superRefine((a,c)=>{
 if(a.reviewStatus==='approved' && (!a.reviewer || !a.reviewedAt || !a.publishedAt || !a.factualClaimsReviewedAt)) c.addIssue({code:'custom',message:'Approval requires actual reviewer, review dates and publication date'});
 if(a.brand==='kids' && (!a.ageGuidance || !a.materials?.length || !a.supervision || !a.safetyNotes?.length || !a.screenFreeExtension)) c.addIssue({code:'custom',message:'Kids requires age guidance, materials, supervision, safety and screen-free extension'});
 if(a.contentType==='activity' && (!a.materials?.length || !a.supervision || !a.safetyNotes?.length)) c.addIssue({code:'custom',message:'Activity requires materials and safety'});
 if(a.contentType==='video' && (!a.poster || !a.transcript || !a.productionStatus)) c.addIssue({code:'custom',message:'Video requires production status, poster and descriptive transcript'});
 if(a.productionStatus==='available' && (!a.videoSrc || !a.captionsSrc || !a.durationSeconds)) c.addIssue({code:'custom',message:'Available video requires media, captions and duration'});
});
export const quizSchema = z.object({id:z.string().regex(/^[a-z0-9-]+$/),scheduledDate:dateSchema,brand:brandSchema,prompt:z.string().min(10),options:z.array(z.object({id:z.string().min(1),text:z.string().min(1)})).length(4),correctOptionId:z.string(),explanation:z.string().min(20),difficulty:z.enum(['easy','medium']),sources:z.array(sourceSchema),...review}).superRefine((q,c)=>{
 if(new Set(q.options.map(o=>o.id)).size!==4 || new Set(q.options.map(o=>o.text.trim().toLowerCase())).size!==4) c.addIssue({code:'custom',message:'Four distinct option IDs and texts required'});
 if(!q.options.some(o=>o.id===q.correctOptionId)) c.addIssue({code:'custom',message:'Correct option must exist'});
 if(q.reviewStatus==='approved' && (!q.reviewer || !q.reviewedAt)) c.addIssue({code:'custom',message:'Human approval requires actual review identity and date'});
});
export type Article = z.infer<typeof articleSchema>;
export type Quiz = z.infer<typeof quizSchema>;
export function assertUnique(items: {id:string;scheduledDate?:string;slug?:string;brand?:string}[]) {
 for(const key of ['id','scheduledDate','route'] as const) {
 const values = items.map(i=>key==='route' ? (i.slug ? `${i.brand}/${i.slug}` : undefined) : i[key]).filter(Boolean);
 if(new Set(values).size!==values.length) throw new Error(`Duplicate ${key}`);
 }
}
