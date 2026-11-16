// @vitest-environment node
// The publishing-report endpoints over the request layer (the same functions the routes call): role isolation is
// the security property of this pair — only a reviewer key may report a batch, only a promoter key its digest
// post — so it is asserted here for every other role, for a world-scoped key, and for no key at all.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { createLimiter } from '@/lib/agents/rate-limit';
import { reviewReportRequest, digestPostRequest } from '@/lib/agents/publishing-api';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let reviewerKey: string;
let promoterKey: string;
let moderationKey: string;
let masterKey: string;
let worldKey: string;

const deps = () => ({ db, limiter: createLimiter({ perMinute: 600 }) });
const post = (url: string, key: string | null, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { ...(key ? { 'x-agent-key': key } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// A batch date inside the endpoints' reporting window (relative to today in America/New_York).
const etDay = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const reportBody = {
  date: etDay(-2),
  published: [{ world: 'play', kind: 'article', title: 'How to fly a kite', slug: 'how-to-fly-a-kite' }],
  rejections: [],
};
const digestBody = { date: etDay(-2), postUrl: 'https://www.facebook.com/page/posts/123', externalId: '123' };

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  reviewerKey = (await createAgent(db, 'api-reviewer', null, 'reviewer')).key;
  promoterKey = (await createAgent(db, 'api-promoter', null, 'promoter')).key;
  moderationKey = (await createAgent(db, 'api-moderator', null, 'moderation')).key;
  masterKey = (await createAgent(db, 'api-master', null)).key;
  worldKey = (await createAgent(db, 'api-play', 'play')).key;
});
afterAll(async () => {
  await db.close();
});

describe('publishing report endpoint roles', () => {
  it('accepts a reviewer key', async () => {
    const r = await reviewReportRequest(post('https://s.example.test/api/agent/publishing/report/', reviewerKey, reportBody), deps());
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  it('refuses promoter, moderation, master and world-scoped keys with 403 and no data', async () => {
    for (const key of [promoterKey, moderationKey, masterKey, worldKey]) {
      const r = await reviewReportRequest(post('https://s.example.test/api/agent/publishing/report/', key, reportBody), deps());
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: 'forbidden_role' });
    }
  });

  it('refuses a missing or bogus key with 401', async () => {
    for (const key of [null, 'sk_bogus_key']) {
      const r = await reviewReportRequest(post('https://s.example.test/api/agent/publishing/report/', key, reportBody), deps());
      expect(r.status).toBe(401);
    }
  });
});

describe('publishing digest endpoint roles', () => {
  it('accepts a promoter key', async () => {
    const r = await digestPostRequest(post('https://s.example.test/api/agent/publishing/digest/', promoterKey, digestBody), deps());
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  it('refuses reviewer, moderation, master and world-scoped keys with 403 and no data', async () => {
    for (const key of [reviewerKey, moderationKey, masterKey, worldKey]) {
      const r = await digestPostRequest(post('https://s.example.test/api/agent/publishing/digest/', key, digestBody), deps());
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: 'forbidden_role' });
    }
  });

  it('refuses a missing or bogus key with 401', async () => {
    for (const key of [null, 'sk_bogus_key']) {
      const r = await digestPostRequest(post('https://s.example.test/api/agent/publishing/digest/', key, digestBody), deps());
      expect(r.status).toBe(401);
    }
  });
});
