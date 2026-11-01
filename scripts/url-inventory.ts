// Checks every URL of the old static site against a running SparkKindly app (cut-over step: page-by-page comparison).
// Read-only GETs, one at a time, with a timeout. Allowed hosts only: localhost, 127.0.0.1, staging.sparkkindly.com and
// sparkkindly.com (the post-cut-over check). Usage:
//   npx tsx scripts/url-inventory.ts --base http://localhost:4173
//   read -r -p 'user: ' STAGING_USER; read -r -s -p 'password: ' STAGING_PASS; export STAGING_USER STAGING_PASS
//   npx tsx scripts/url-inventory.ts --base https://staging.sparkkindly.com
// Basic-auth credentials come only from the environment, are never printed, and are sent only over https or to loopback.
// Exits 1 if any entry fails or none was checked, 2 on bad usage.
// Verified by: tests/unit/url-inventory.test.ts, tests/unit/cutover-guard.test.ts and a run against the local e2e server.
import { buildInventory, checkEntry } from '../lib/cutover/inventory';
import { checkTarget } from '../lib/cutover/guard';
import { readFolder } from '../lib/repository';

const ALLOWED = ['localhost', '127.0.0.1', 'staging.sparkkindly.com', 'sparkkindly.com'];
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const target = checkTarget(arg('base') ?? '', { allowed: ALLOWED });
  if (!target.ok) {
    console.error(`Refusing: ${target.reason}. Usage: url-inventory.ts --base <http(s)://host[:port]>`);
    process.exit(2);
  }
  const base = target.url;
  const headers: Record<string, string> = {};
  const { STAGING_USER: user, STAGING_PASS: pass } = process.env;
  if (user && pass) {
    if (!target.authAllowed) {
      console.error('Refusing to send credentials over plain http to a non-loopback host.');
      process.exit(2);
    }
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }

  const articles = readFolder('articles') as { brand: string; slug: string; reviewStatus?: string }[];
  const quizzes = readFolder('quizzes') as { id: string; brand: string; reviewStatus?: string }[];
  const inventory = buildInventory(articles.filter((a) => a.reviewStatus === 'approved'), quizzes.filter((q) => q.reviewStatus === 'approved'));

  const failures: string[] = [];
  for (const entry of inventory) {
    try {
      const res = await fetch(new URL(entry.path, base), { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      const problem = checkEntry(entry, { status: res.status, location: res.headers.get('location') });
      if (problem) failures.push(problem);
    } catch (e) {
      failures.push(`${entry.path}: ${(e as Error).name}`);
    }
  }
  console.log(`${inventory.length - failures.length} of ${inventory.length} URLs as expected`);
  failures.forEach((f) => console.log(`FAIL ${f}`));
  process.exit(failures.length || inventory.length === 0 ? 1 : 0);
}

main();
