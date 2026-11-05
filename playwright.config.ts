import {defineConfig,devices} from '@playwright/test';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export const E2E_DATABASE_URL='postgres://postgres@127.0.0.1:54329/postgres?sslmode=disable';
// Plan 5B: uploaded videos in the e2e run go to the OS temp folder, never the repo or /opt.
export const E2E_MEDIA_DIR=join(tmpdir(),'sparkkindly-e2e-media');
export default defineConfig({testDir:'./tests/e2e',fullyParallel:false,workers:1,use:{baseURL:'http://localhost:4173',trace:'retain-on-failure'},webServer:[
 {command:'npx tsx scripts/e2e-db.ts',port:54329,reuseExistingServer:!process.env.CI,timeout:120_000},
 {command:'npm run preview',url:'http://localhost:4173',reuseExistingServer:!process.env.CI,env:{DATABASE_URL:E2E_DATABASE_URL,DB_POOL_MAX:'1',ACCOUNTS_ENABLED:'true',CIRCLES_ENABLED:'true',COMMENTS_ENABLED:'true',CONTRIBUTORS_ENABLED:'true',SPONSORSHIP_ENABLED:'true',SOCIAL_ENABLED:'true',SOCIAL_MEDIA_DIR:E2E_MEDIA_DIR,ADMIN_EMAILS:'owner@example.test',ADMIN_SECRET_KEY:Buffer.alloc(32,1).toString('base64')/* test-only key, same as TEST_SECRET_KEY */,UNSUBSCRIBE_SECRET:'e2e-test-only-unsubscribe-secret-not-real-0001'}},
 // A second server whose database is unreachable, to check the error page leaks nothing.
 {command:'npx next start -p 4174',port:4174,reuseExistingServer:!process.env.CI,env:{DATABASE_URL:'postgres://postgres@127.0.0.1:1/none?sslmode=disable'}},
],projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}]});
