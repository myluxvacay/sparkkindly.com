import fs from 'node:fs/promises';
import {contentDatabase} from './mongodb-client';
import {articleSchema,quizSchema,assertUnique} from '../lib/schemas';
import {approvalRecordSchema,contentFingerprint} from '../lib/editorial-approval';
import type {MongoClient} from 'mongodb';
let client:MongoClient|undefined;
try {
 const record=approvalRecordSchema.parse(JSON.parse(await fs.readFile('docs/editorial-approval.json','utf8')));
 const connection=await contentDatabase();client=connection.client;await client.connect();
 const docs=await connection.collection.find({kind:{$in:['article','quiz']}},{projection:{_id:0}}).toArray();
 const parsed=docs.map(d=>({kind:d.kind,entry:d.kind==='article'?articleSchema.parse(d):quizSchema.parse(d)}));
 assertUnique(parsed.map(d=>({...d.entry,id:`${d.kind}:${d.entry.id}`})));
 const operations=[];
 for(const approved of record.entries) {
   const current=parsed.find(d=>d.kind===approved.kind && d.entry.id===approved.id);
   if(!current)throw new Error('Approved entry is missing from the database');
   const hash=contentFingerprint(current.entry);
   if(hash===approved.approvedHash)continue;
   if(hash!==approved.priorHash)throw new Error('Content changed since approval; review the new revision before applying approval');
   const updated={...current.entry,...approved.fields};
   const checked=approved.kind==='article'?articleSchema.parse(updated):quizSchema.parse(updated);
   if(contentFingerprint(checked)!==approved.approvedHash)throw new Error('Approval record does not match the approved content');
   // Exact prior fields make this conditional: concurrent editorial changes are not overwritten.
   operations.push({updateOne:{filter:{kind:approved.kind,...current.entry},update:{$set:approved.fields}}});
 }
 if(operations.length){
   const result=await connection.collection.bulkWrite(operations,{ordered:true});
   if(result.matchedCount!==operations.length)throw new Error('Some entries changed concurrently. Earlier approvals may have applied; recheck before retrying.');
 }
 console.log(`Owner approval synchronized: ${record.entries.length} entries approved; ${operations.length} records updated. Existing text and unrelated documents preserved.`);
 console.log('Run npm run content:pull to refresh the validated build snapshot.');
} catch {
 console.error('Approval sync stopped. Check tunnel/credentials and ensure the database content matches the reviewed snapshot. Some records may already be approved; the command is safe to retry for unchanged records. No connection details or passwords were logged.');
 process.exitCode=1;
} finally {await client?.close();}
