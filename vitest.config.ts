import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';
// fileURLToPath, not .pathname: on Windows .pathname gives "/C:/…/New%20folder/…", which Vite cannot resolve.
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},test:{environment:'jsdom',setupFiles:['./tests/setup.ts'],include:['tests/unit/**/*.test.{ts,tsx}']}});
