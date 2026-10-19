import {MongoClient} from 'mongodb';
import {readPassword} from './password-prompt';
export async function contentDatabase() {
  try {process.loadEnvFile('.env.local');} catch {}
  const dbName=process.env.MONGODB_DB ?? 'sparkkindly_local';
  const username=process.env.MONGODB_USERNAME;
  const password=username ? (process.env.MONGODB_PASSWORD || await readPassword(`MongoDB password for ${username} (hidden): `)) : undefined;
  const client=new MongoClient(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/',{serverSelectionTimeoutMS:5000,...(username?{auth:{username,password:password!},authSource:process.env.MONGODB_AUTH_SOURCE ?? dbName}:{})});
  return {client,collection:client.db(dbName).collection(process.env.MONGODB_COLLECTION ?? 'sparkkindly')};
}
