// Dependency-free load test for the cut-over rehearsal on STAGING (spec: double the expected launch traffic while
// MyLuxVacation's memory and response times are watched). Read-only GETs over a fixed mix of public pages.
//   npx tsx scripts/load-test.ts --base http://localhost:4173 --concurrency 8 --seconds 20
//   read -r -p 'user: ' STAGING_USER; read -r -s -p 'password: ' STAGING_PASS; export STAGING_USER STAGING_PASS
//   npx tsx scripts/load-test.ts --base https://staging.sparkkindly.com --concurrency 10 --seconds 120
// Allowed hosts are an allow-list: localhost, 127.0.0.1 and staging.sparkkindly.com. Production (sparkkindly.com) is
// allowed only with --allow-production, which needs the owner's authorization. Credentials come only from the
// environment, are never printed, and are sent only over https or to loopback.
// Prints requests, errors, requests/second and p50/p95/p99 latency. Exit 1 if more than 1% of requests fail, p95 exceeds
// --max-p95-ms (default 1500) or no request was made; exit 2 on bad usage (including non-numeric options).
// Verified by: tests/unit/cutover-guard.test.ts and a run against the local e2e server (docs/CUTOVER.md).
import { checkTarget, parseBound } from '../lib/cutover/guard';

const PATHS = [
  '/', '/play/', '/discover/', '/together/', '/grow/', '/kids/', '/quiz/', '/quiz/archive/', '/search/?q=shadows',
  '/discover/a-day-in-shadows/', '/play/number-detective-001/', '/about/', '/privacy/',
];

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function usage(message: string): never {
  console.error(`Refusing: ${message}. Usage: load-test.ts --base <url> [--concurrency 8] [--seconds 20] [--max-p95-ms 1500] [--allow-production]`);
  process.exit(2);
}

async function main() {
  const allowed = ['localhost', '127.0.0.1', 'staging.sparkkindly.com'];
  if (process.argv.includes('--allow-production')) allowed.push('sparkkindly.com');
  const target = checkTarget(arg('base') ?? '', { allowed });
  if (!target.ok) usage(target.reason);
  const concurrency = parseBound(arg('concurrency'), 8, 1, 100);
  const seconds = parseBound(arg('seconds'), 20, 1, 600);
  const maxP95 = parseBound(arg('max-p95-ms'), 1500, 1, 600_000);
  if (concurrency === null || seconds === null || maxP95 === null) usage('--concurrency, --seconds and --max-p95-ms must be finite numbers');

  const headers: Record<string, string> = {};
  const { STAGING_USER: user, STAGING_PASS: pass } = process.env;
  if (user && pass) {
    if (!target.authAllowed) usage('credentials are only sent over https or to loopback');
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }

  const latencies: number[] = [];
  let errors = 0;
  const end = Date.now() + seconds * 1000;
  let n = 0;
  const worker = async () => {
    while (Date.now() < end) {
      const path = PATHS[n++ % PATHS.length];
      const t0 = performance.now();
      try {
        const res = await fetch(new URL(path, target.url), { headers, signal: AbortSignal.timeout(15_000) });
        await res.arrayBuffer();
        if (res.status !== 200) errors++;
      } catch {
        errors++;
      }
      latencies.push(performance.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: Math.floor(concurrency) }, worker));

  latencies.sort((a, b) => a - b);
  const p95 = percentile(latencies, 95);
  console.log(
    `requests=${latencies.length} errors=${errors} rps=${(latencies.length / seconds).toFixed(1)} ` +
      `p50=${percentile(latencies, 50).toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${percentile(latencies, 99).toFixed(0)}ms`,
  );
  const failed = latencies.length === 0 || errors / latencies.length > 0.01 || p95 > maxP95;
  process.exit(failed ? 1 : 0);
}

main();
