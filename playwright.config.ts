import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./tests/e2e',fullyParallel:false,workers:2,use:{baseURL:'http://localhost:4173',trace:'retain-on-failure'},webServer:{command:'npm run preview',url:'http://localhost:4173',reuseExistingServer:!process.env.CI},projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}]});
