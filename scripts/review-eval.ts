// Evaluates the real reviewer agent against agents/fixtures/review/*.json by running `claude -p --agent
// sparkkindly-reviewer` once per fixture, and checks each verdict against the label. It costs Claude plan usage (one
// short run per fixture, with web fetches), so it is run by hand, never in CI. Exit code 1 on any mismatch.
// Usage: npx tsx scripts/review-eval.ts [--model <id>]
// Verified by: tests/unit/agent-formats.test.ts (fixtures are valid submissions) and a recorded run in docs/OPERATIONS.md.
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVerdict, type Tier } from '../lib/agents/verdict';

type Fixture = { expect: 'pass' | 'fail'; tier: Tier; world: string; recentTitles: string[]; item: unknown };
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'agents/fixtures/review');
const modelFlag = process.argv.indexOf('--model');
const model = modelFlag > 0 ? process.argv[modelFlag + 1] : undefined;

function review(f: Fixture): string {
  const goals = readFileSync(path.join(root, `agents/worlds/${f.world}.md`), 'utf8');
  const prompt = `tier: ${f.tier}\nrecentTitles: ${JSON.stringify(f.recentTitles)}\n\nGOALS FILE:\n${goals}\n\nITEM:\n${JSON.stringify(f.item, null, 2)}`;
  const args = ['-p', '--agent', 'sparkkindly-reviewer', '--output-format', 'text', '--allowedTools', 'WebFetch', 'WebSearch', ...(model ? ['--model', model] : [])];
  const r = spawnSync('claude', args, { input: prompt, encoding: 'utf8', timeout: 300_000, shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`claude exited ${r.status}: ${(r.stderr || r.error?.message || '').slice(0, 200)}`);
  return r.stdout;
}

let bad = 0;
for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
  const f = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as Fixture;
  let got: string;
  let why = '';
  try {
    const out = review(f);
    const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    const v = parseVerdict(json, { tier: f.tier });
    got = v.pass ? 'pass' : 'fail';
    why = v.reasons.join(' | ').slice(0, 300);
  } catch (err) {
    got = 'fail'; // an unusable answer counts as a fail, exactly as the master treats it
    why = `UNUSABLE ANSWER (${(err as Error).message.slice(0, 120)}): this is not a real judgement`;
  }
  const ok = got === f.expect && !why.startsWith('UNUSABLE');
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'MISS'} ${name}: expected ${f.expect}, got ${got}${why ? `
       ${why}` : ''}`);
}
console.log(bad ? `${bad} fixture(s) not judged as labelled: fix the reviewer prompt before relying on it.` : 'All fixtures judged as labelled.');
process.exit(bad ? 1 : 0);
