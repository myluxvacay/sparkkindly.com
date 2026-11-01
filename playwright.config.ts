import {defineConfig,devices} from '@playwright/test';
export const E2E_DATABASE_URL='postgres://postgres@127.0.0.1:54329/postgres?sslmode=disable';
export default defineConfig({testDir:'./tests/e2e',fullyParallel:false,workers:2,use:{baseURL:'http://localhost:4173',trace:'retain-on-failure'},webServer:[
 {command:'npx tsx scripts/e2e-db.ts',port:54329,reuseExistingServer:!process.env.CI,timeout:120_000},
 {command:'npm run preview',url:'http://localhost:4173',reuseExistingServer:!process.env.CI,env:{DATABASE_URL:E2E_DATABASE_URL}},
],projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}]});
