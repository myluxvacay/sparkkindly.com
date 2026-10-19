import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,cpSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
it('the real build validator rejects malformed content before export',()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'sparkkindly-invalid-'));
 try{
 mkdirSync(path.join(temp,'content/articles'),{recursive:true});mkdirSync(path.join(temp,'content/quizzes'),{recursive:true});
 writeFileSync(path.join(temp,'content/articles/broken.json'),JSON.stringify({brand:'invented',title:'Invalid content'}));
 const require=createRequire(import.meta.url);
 const result=spawnSync(process.execPath,['--import',pathToFileURL(require.resolve('tsx')).href,path.resolve('scripts/validate-content.ts')],{cwd:temp,env:{...process.env,CONTENT_SOURCE:'local'},encoding:'utf8'});
 expect(result.status).not.toBe(0);expect(result.stderr).toContain('ZodError');
 }finally{rmSync(temp,{recursive:true,force:true});}
});

it('the real release validator accepts the approved revision and rejects valid edited content',()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'sparkkindly-approval-'));
 try {
  cpSync(path.resolve('content'),path.join(temp,'content'),{recursive:true});
  mkdirSync(path.join(temp,'docs'));
  for(const name of ['launch-approval.json','editorial-approval.json'])cpSync(path.resolve('docs',name),path.join(temp,'docs',name));
  symlinkSync(path.resolve('public'),path.join(temp,'public'),'dir');
  const require=createRequire(import.meta.url);
  const run=()=>spawnSync(process.execPath,['--import',pathToFileURL(require.resolve('tsx')).href,path.resolve('scripts/validate-content.ts')],{cwd:temp,env:{...process.env,CONTENT_SOURCE:'local',SITE_RELEASE:'true'},encoding:'utf8'});
  expect(run().status).toBe(0);
  const file=path.join(temp,'content/articles/a-day-in-shadows.json');
  const original=readFileSync(file,'utf8');
  const entry=JSON.parse(original);entry.description+=' An edited revision.';
  writeFileSync(file,JSON.stringify(entry));
  const changed=run();expect(changed.status).not.toBe(0);expect(changed.stderr).toContain('changed since owner approval');
  writeFileSync(file,original);
  const quizFile=path.join(temp,'content/quizzes/number-detective-001.json');
  const quiz=JSON.parse(readFileSync(quizFile,'utf8'));quiz.explanation+=' New wording.';
  writeFileSync(quizFile,JSON.stringify(quiz));
  const changedQuiz=run();expect(changedQuiz.status).not.toBe(0);expect(changedQuiz.stderr).toContain('changed since owner approval');
 }finally{rmSync(temp,{recursive:true,force:true});}
});
