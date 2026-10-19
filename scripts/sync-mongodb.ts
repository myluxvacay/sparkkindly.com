import { MongoClient } from 'mongodb';
import {contentDatabase} from './mongodb-client';
import fs from 'node:fs/promises';
import { readFolder } from '../lib/repository';
import { articleSchema,quizSchema,assertUnique } from '../lib/schemas';
let client: MongoClient | undefined;
try {
 const connection=await contentDatabase();
 client=connection.client;
 await client.connect();
 const collection=connection.collection;
 if(process.argv.includes('--seed')) {
  const articles=readFolder('articles').map(a=>articleSchema.parse(a));
  const quizzes=readFolder('quizzes').map(q=>quizSchema.parse(q));
  const docs=[...articles.map(a=>({...a,kind:'article'})),...quizzes.map(q=>({...q,kind:'quiz'}))];
  const result=await collection.bulkWrite(docs.map(d=>({updateOne:{filter:{kind:d.kind,id:d.id},update:{$setOnInsert:d},upsert:true}})));
  console.log(`Seed complete: ${result.upsertedCount} new documents; existing records preserved.`);
 }
 const docs=await collection.find({kind:{$in:['article','quiz']}},{projection:{_id:0}}).toArray();
 const articles=docs.filter(d=>d.kind==='article').map(d=>articleSchema.parse(d));
 const quizzes=docs.filter(d=>d.kind==='quiz').map(d=>quizSchema.parse(d));
 assertUnique(articles); assertUnique(quizzes);
 if(articles.length<10 || quizzes.length<14) throw new Error('MongoDB snapshot is incomplete: require 10 articles and 14 quizzes');
 const snapshot={articles,quizzes};
 await fs.writeFile('content/mongodb.snapshot.json.tmp',JSON.stringify(snapshot,null,2)+'\n');
 await fs.rename('content/mongodb.snapshot.json.tmp','content/mongodb.snapshot.json');
 console.log(`Validated MongoDB snapshot: ${articles.length} articles, ${quizzes.length} quizzes. No database connection is used by the browser.`);
} catch {
 console.error('MongoDB sync failed. Check that the SSH tunnel/database is running, credentials are correct, and content is valid. Connection details have not been logged.');
 process.exitCode=1;
} finally {await client?.close();}
