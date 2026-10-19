import fs from 'node:fs';
import path from 'node:path';
export function readFolder(folder:string): unknown[] { return fs.readdirSync(path.join(process.cwd(),'content',folder)).filter(f=>f.endsWith('.json')).sort().map(f=>JSON.parse(fs.readFileSync(path.join(process.cwd(),'content',folder,f),'utf8'))); }
