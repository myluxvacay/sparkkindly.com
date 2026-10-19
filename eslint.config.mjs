import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([...nextVitals, ...nextTs, globalIgnores(['out/**', '.next/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts']), {rules: {'@next/next/no-img-element': 'off'}}]);
