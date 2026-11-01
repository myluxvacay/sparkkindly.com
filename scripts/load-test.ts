// Dependency-free load test for the cut-over rehearsal on STAGING (spec: double the expected launch traffic while
// MyLuxVacation's memory and response times are watched). Read-only GETs over a fixed mix of public pages.
//   npx tsx scripts/load-test.ts --base http://localhost:4173 --concurrency 8 --seconds 20
//   STAGING_USER=... STAGING_PASS=... npx tsx scripts/load-test.ts --base https://staging.sparkkindly.com --concurrency 20 --seconds 120
// It refuses to run against sparkkindly.com or www.sparkkindly.com (production) unless --allow-production is given;
// the owner must authorize that. Credentials come only from the environment and are never printed.
// Prints requests, errors, requests/second and p50/p95/p99 latency. Exits 1 if more than 1% of requests fail
// or p95 exceeds --max-p95-ms (default 1500). Verified by: a run against the local e2e server (docs/CUTOVER.md).
const PATHS = [
  '/', '/play/', '/discover/', '/together/', '/grow/', '/kids/', '/quiz/', '/quiz/archive/', '/search/?q=shadows',
  '/discover/a-day-in-shadows/', '/play/number-detective-001/', '/about/', '/privacy/',
];

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  const base = arg('base');
  if (!base || !/^https?:\/\//.test(base)) {
    console.error('Usage: load-test.ts --base <url> [--concurrency 8] [--seconds 20] [--max-p95-ms 1500] [--allow-production]');
    process.exit(2);
  }
  const host = new URL(base).hostname;
  if (/^(www\.)?sparkkindly\.com$/.test(host) && !process.argv.includes('--allow-production')) {
    console.error('Refusing to load-test production without --allow-production (owner authorization required).');
    process.exit(2);
  }
  const concurrency = Math.max(1, Math.min(Number(arg('concurrency', '8')), 100));
  const seconds = Math.max(1, Math.min(Number(arg('seconds', '20')), 600));
  const maxP95 = Number(arg('max-p95-ms', '1500'));
  const headers: Record<string, string> = {};
  const { STAGING_USER: user, STAGING_PASS: pass } = process.env;
  if (user && pass) headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

  const latencies: number[] = [];
  let errors = 0;
  const end = Date.now() + seconds * 1000;
  let n = 0;
  const worker = async () => {
    while (Date.now() < end) {
      const path = PATHS[n++ % PATHS.length];
      const t0 = performance.now();
      try {
        const res = await fetch(new URL(path, base), { headers, signal: AbortSignal.timeout(15_000) });
        await res.arrayBuffer();
        if (res.status !== 200) errors++;
      } catch {
        errors++;
      }
      latencies.push(performance.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  latencies.sort((a, b) => a - b);
  const p95 = percentile(latencies, 95);
  console.log(
    `requests=${latencies.length} errors=${errors} rps=${(latencies.length / seconds).toFixed(1)} ` +
      `p50=${percentile(latencies, 50).toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${percentile(latencies, 99).toFixed(0)}ms`,
  );
  process.exit(errors / Math.max(latencies.length, 1) > 0.01 || p95 > maxP95 ? 1 : 0);
}

main();
