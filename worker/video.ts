// The SparkKindly video tick (plan 5B; 5B review M4): one run of lib/jobs/video.ts, started every 5 minutes by its own
// systemd timer (deploy/systemd/sparkkindly-video-poster*.timer) as a oneshot service with a 30 minute start timeout and
// 512 MB, so long uploads never hold up the one-minute worker. Built into the release as video-worker.mjs by
// `npm run worker:video:build`. Verified by tests/unit/social-video-poster.test.ts, video-worker-units.test.ts and
// worker-bundle.test.ts.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { videoTick } from '@/lib/jobs/video';

async function main() {
  const { getDb, getPool } = await import('@/lib/db');
  try {
    const log: string[] = [];
    await videoTick(getDb(), new Date(), process.env, log, { fetch });
    console.log(`video tick: ${log.join('; ')}`);
  } finally {
    await getPool().end();
  }
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  main().catch((err) => {
    console.error('video tick failed:', (err as Error).name);
    process.exitCode = 1;
  });
}
