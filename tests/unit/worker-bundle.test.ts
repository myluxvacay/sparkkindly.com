// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pkg from '../../package.json';

// The server runs worker.mjs from a Next standalone release, whose node_modules holds only what Next traced (pg, react,
// next...). Anything else the worker imports must be bundled into worker.mjs, or every tick dies with
// ERR_MODULE_NOT_FOUND (it did, on staging, when the heartbeat pulled in zod). Unit tests cannot see this because they
// run with the full node_modules, so this builds the worker exactly as the deploy does and reads its imports.
const ALLOWED_EXTERNAL = new Set(['pg']);

describe('the worker bundle', () => {
  it('imports only node built-ins and packages the standalone release ships', () => {
    const script = pkg.scripts['worker:build'] as string;
    const args = script.replace(/^esbuild\s+/, '').split(/\s+/).filter((a) => !a.startsWith('--outfile='));
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'worker-bundle-')), 'worker.mjs');
    execFileSync('npx', ['esbuild', ...args, `--outfile=${out}`], { stdio: 'pipe', shell: process.platform === 'win32' });

    const code = readFileSync(out, 'utf8');
    const specifiers = [...code.matchAll(/^\s*import\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm)].map((m) => m[1]);
    const external = [...new Set(specifiers.filter((s) => !s.startsWith('node:') && !s.startsWith('.') && !s.startsWith('/')))];
    const unexpected = external.filter((s) => !ALLOWED_EXTERNAL.has(s));
    expect(unexpected, `worker.mjs imports packages the server does not have: ${unexpected.join(', ')}`).toEqual([]);
  }, 60_000);
});
