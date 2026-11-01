import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// fileURLToPath, not .pathname: on Windows .pathname gives "/C:/…/New%20folder/…", which Vite cannot resolve.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    // Database tests start an in-process PostgreSQL (PGlite, WebAssembly). Under a parallel run the first start in a
    // file can take several seconds, so the 5 s default is too tight for them.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
