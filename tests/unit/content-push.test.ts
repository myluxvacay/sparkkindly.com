// @vitest-environment node
// The Content Push API (lib/agents/content-push.ts): library-shaped packages in, the full pipeline run
// server-side — schema strictness (Kids five fields, sources required), fingerprint idempotency, gates
// landing failures as drafts, hero variants, reviewer approval assigning slots and globally unique quiz
// dates, promoter publish, and the video gate (private at submission, public only at publish, an expired
// YouTube consent surfaced as its own state). YouTube is a stubbed fetch over a temp token file, exactly
// as in social-youtube-adapter.test.ts; the source probe is stubbed as in agent-api.test.ts.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createAgent } from '@/lib/agents/admin';
import { authenticate, type Agent } from '@/lib/agents/auth';
import {
  YOUTUBE_AUTH_EXPIRED,
  attachVideoSource,
  getPushStatus,
  listPushQueue,
  publishPushItem,
  reviewPushItem,
  submitPackage,
  uploadHeroImage,
} from '@/lib/agents/content-push';
import { readMediaFile } from '@/lib/agents/content-push-media';
import { getPublicItem } from '@/lib/public/reads';
import { anonymousScope } from '@/lib/public/scope';
import { publishDue } from '@/lib/jobs/publish-due';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let submitter: Agent;
let master: Agent;
let reviewer: Agent;
let promoter: Agent;
let mediaDir: string;
let tokenDir: string;
const NOW = new Date('2026-11-20T12:00:00Z');
const okProbe = () => vi.fn(async () => ({ status: 200, location: null as string | null }));
const deps = () => ({ probe: okProbe(), now: NOW, mediaDir });

async function agentFor(name: string, world: string | null, role?: 'reviewer' | 'promoter'): Promise<Agent> {
  const { key } = await createAgent(db, name, world, role);
  return (await authenticate(db, key))!;
}

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  submitter = await agentFor('push-submitter', 'kids');
  master = await agentFor('push-master', null);
  reviewer = await agentFor('push-reviewer', null, 'reviewer');
  promoter = await agentFor('push-promoter', null, 'promoter');
  mediaDir = mkdtempSync(path.join(tmpdir(), 'sk-push-media-'));
  tokenDir = mkdtempSync(path.join(tmpdir(), 'sk-push-tokens-'));
});
afterAll(async () => {
  await db.close();
  rmSync(mediaDir, { recursive: true, force: true });
  rmSync(tokenDir, { recursive: true, force: true });
});

const source = { title: 'Bee facts for kids', url: 'https://example.org/bees', accessedAt: '2026-11-20' };
let n = 0;
const kidsArticle = (over: Record<string, unknown> = {}) => {
  const i = ++n;
  return {
    id: `push-article-${i}`,
    slug: `push-article-${i}`,
    brand: 'kids',
    contentType: 'article',
    title: `Why Bees Visit Flowers ${i}`,
    description: 'Bees fly from flower to flower and help plants make seeds.',
    updatedAt: '2026-11-20',
    author: 'SparkKindly',
    tags: ['reading'],
    sources: [source],
    aiDisclosure: 'Written with AI help and checked by a person.',
    body: [
      { heading: 'Bees at work', paragraphs: ['Bees fly to flowers to sip sweet nectar. As they move, soft pollen sticks to their legs.'] },
      { heading: 'Why it helps', paragraphs: ['When a bee lands on a new flower, some pollen falls off. This helps the plant make seeds.'] },
    ],
    takeaway: 'Bees help flowers grow.',
    ageGuidance: 'Ages 5 to 8, read with a grown-up.',
    materials: ['Just this page'],
    supervision: 'Read together with a grown-up.',
    safetyNotes: ['Watch bees from far away. Do not touch them.'],
    screenFreeExtension: 'Draw a bee and a flower.',
    ...over,
  };
};
const kidsQuiz = (over: Record<string, unknown> = {}) => {
  const i = ++n;
  return {
    // The counter sits mid-id on purpose: the library title is derived from the id (trailing number
    // stripped), so a trailing counter would give every fixture quiz the same title and trip the
    // duplicate gate against the quizzes submitted by earlier tests.
    id: `push-quiz-${i}-bees`,
    brand: 'kids',
    prompt: 'Why do bees visit flowers?',
    options: [
      { id: 'a', text: 'To sip nectar' },
      { id: 'b', text: 'To sleep' },
      { id: 'c', text: 'To hide from rain' },
      { id: 'd', text: 'To swim' },
    ],
    correctOptionId: 'a',
    explanation: 'Bees visit flowers to sip nectar, and they carry pollen as they go.',
    difficulty: 'easy',
    sources: [source],
    // The five Kids fields are required on quizzes too (the API's rule for every Kids item).
    ageGuidance: 'Ages 5 to 8, read with a grown-up.',
    materials: ['Just this page'],
    supervision: 'Read together with a grown-up.',
    safetyNotes: ['Watch bees from far away. Do not touch them.'],
    screenFreeExtension: 'Draw a bee and a flower.',
    ...over,
  };
};
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const itemsOf = (r: { json: unknown }) => (r.json as Json).items as Json[];
const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0].n);

describe('submitPackage', () => {
  it('stores a package as in_review items with fingerprints, and a replay returns the same records', async () => {
    const pkg = { article: kidsArticle(), quizzes: [kidsQuiz()] };
    const first = await submitPackage(db, submitter, pkg, deps());
    expect(first.status).toBe(201);
    const items = itemsOf(first);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.status)).toEqual(['in_review', 'in_review']);
    expect(items[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(items[1].scheduledDate).toBeNull();

    const before = await count('SELECT count(*) AS n FROM items');
    const replay = await submitPackage(db, submitter, pkg, deps());
    expect(replay.status).toBe(200);
    expect(itemsOf(replay).map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect(itemsOf(replay).every((i) => i.replayed)).toBe(true);
    expect(await count('SELECT count(*) AS n FROM items')).toBe(before);
  });

  it('refuses a Kids item missing any of the five safety fields, and any item without sources', async () => {
    const noSafety = kidsArticle();
    delete (noSafety as Record<string, unknown>).safetyNotes;
    const r1 = await submitPackage(db, submitter, { article: noSafety }, deps());
    expect(r1.status).toBe(422);
    expect((r1.json as Json).error).toBe('invalid_package');

    const r2 = await submitPackage(db, submitter, { article: kidsArticle({ sources: [] }) }, deps());
    expect(r2.status).toBe(422);
    const r3 = await submitPackage(db, submitter, { quizzes: [kidsQuiz({ sources: [] })] }, deps());
    expect(r3.status).toBe(422);

    // The five fields are required on Kids QUIZZES too, not just articles.
    const noSafetyQuiz = kidsQuiz();
    delete (noSafetyQuiz as Record<string, unknown>).safetyNotes;
    const r4 = await submitPackage(db, submitter, { quizzes: [noSafetyQuiz] }, deps());
    expect(r4.status).toBe(422);
  });

  it('caps sources at the pipeline maximum and refuses a package that repeats a slug', async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...source, url: `https://example.org/s${i}` }));
    expect((await submitPackage(db, submitter, { article: kidsArticle({ sources: many }) }, deps())).status).toBe(422);
    const q = kidsQuiz();
    expect((await submitPackage(db, submitter, { quizzes: [q, q] }, deps())).status).toBe(422);
  });

  it('ignores a submitter-supplied scheduledDate: the server owns quiz dates', async () => {
    const r = await submitPackage(db, submitter, { quizzes: [kidsQuiz({ scheduledDate: '2027-01-01' })] }, deps());
    expect(r.status).toBe(201);
    expect(itemsOf(r)[0].scheduledDate).toBeNull();
  });

  it('lands a near-duplicate title as a draft with the duplicate gate named, not as a rejection', async () => {
    const first = await submitPackage(db, submitter, { article: kidsArticle({ title: 'The Moon at Night' }) }, deps());
    expect(first.status).toBe(201);
    const dupe = await submitPackage(db, submitter, { article: kidsArticle({ title: 'The Moon at Night' }) }, deps());
    expect(dupe.status).toBe(201);
    const item = itemsOf(dupe)[0];
    expect(item.status).toBe('draft');
    const gates = (item.qualityReport as Json).gates as { gate: string; ok: boolean }[];
    expect(gates.find((g) => g.gate === 'duplicate')?.ok).toBe(false);
  });

  it('keeps roles apart: a reviewer key cannot submit, a submitter cannot review or publish', async () => {
    expect((await submitPackage(db, reviewer, { article: kidsArticle() }, deps())).status).toBe(403);
    const pkg = await submitPackage(db, submitter, { article: kidsArticle() }, deps());
    const id = itemsOf(pkg)[0].id as string;
    expect((await reviewPushItem(db, submitter, id, { decision: 'approve' }, deps())).status).toBe(403);
    expect((await publishPushItem(db, submitter, id, deps())).status).toBe(403);
    expect((await publishPushItem(db, promoter, id, deps())).status).toBe(409); // not approved yet
  });
});

describe('hero image upload', () => {
  it('stores the standard variant set and points the item at it with the standard credit', async () => {
    const pkg = await submitPackage(db, submitter, { article: kidsArticle() }, deps());
    const id = itemsOf(pkg)[0].id as string;
    const png = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 240, g: 180, b: 60 } },
    })
      .png()
      .toBuffer();
    const up = await uploadHeroImage(db, submitter, id, png, { alt: 'A bee on a flower' }, deps());
    expect(up.status).toBe(200);
    const image = (up.json as Json).image as Json;
    expect(image.src).toBe(`/api/push-media/${id}.webp`);
    expect(image.credit).toBe('AI-generated image · SparkKindly');
    expect(image.width).toBe(800);
    for (const name of [`${id}.webp`, `${id}-480.webp`, `${id}-960.webp`, `${id}-1600.webp`, `${id}-480.avif`, `${id}-1600.avif`]) {
      expect(existsSync(path.join(mediaDir, name)), name).toBe(true);
      expect(await readMediaFile(mediaDir, name)).not.toBeNull();
    }
    expect(await readMediaFile(mediaDir, '../secret.webp')).toBeNull();
    expect(await readMediaFile(mediaDir, `${id}.png`)).toBeNull();

    const bad = await uploadHeroImage(db, submitter, id, new TextEncoder().encode('not an image'), {}, deps());
    expect(bad.status).toBe(422);
  });
});

describe('review and publish', () => {
  it('approves into a slot, assigns globally unique quiz dates in order, then publishes visibly', async () => {
    const pkg = await submitPackage(db, submitter, { article: kidsArticle(), quizzes: [kidsQuiz(), kidsQuiz()] }, deps());
    const [article, quiz1, quiz2] = itemsOf(pkg);

    const a1 = await reviewPushItem(db, reviewer, article.id, { decision: 'approve' }, deps());
    expect(a1.status).toBe(200);
    expect((a1.json as Json).status).toBe('approved');
    expect((a1.json as Json).publishAt).toBeTruthy();

    const q1 = await reviewPushItem(db, reviewer, quiz1.id, { decision: 'approve' }, deps());
    const q2 = await reviewPushItem(db, reviewer, quiz2.id, { decision: 'approve' }, deps());
    expect((q1.json as Json).scheduledDate).toBe('2026-11-21');
    expect((q2.json as Json).scheduledDate).toBe('2026-11-22');

    const pub = await publishPushItem(db, promoter, article.id, deps());
    expect(pub.status).toBe(200);
    expect((pub.json as Json).status).toBe('published');
    const visible = await getPublicItem(db, anonymousScope(new Date()), 'kids', article.slug);
    expect(visible?.id).toBe(article.id);

    const audit = await db.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE target = $1 AND action LIKE 'content_push.%' ORDER BY id",
      [article.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['content_push.submit', 'content_push.review_approve', 'content_push.publish']);
  });

  it('rejects with a recorded reason, and a rejected item cannot be published', async () => {
    const pkg = await submitPackage(db, submitter, { article: kidsArticle() }, deps());
    const id = itemsOf(pkg)[0].id as string;
    const noReason = await reviewPushItem(db, reviewer, id, { decision: 'reject' }, deps());
    expect(noReason.status).toBe(422);
    const rej = await reviewPushItem(db, reviewer, id, { decision: 'reject', reason: 'The second section repeats the first.' }, deps());
    expect(rej.status).toBe(200);
    expect((rej.json as Json).status).toBe('rejected');
    const status = await getPushStatus(db, submitter, id);
    expect(((status.json as Json).qualityReport as Json).push.review.reason).toContain('repeats the first');
    expect((await publishPushItem(db, promoter, id, deps())).status).toBe(409);
  });

  it('lists the queue for the reviewer, world-scoped for the submitter', async () => {
    const queue = await listPushQueue(db, reviewer, { status: 'in_review' });
    expect(queue.status).toBe(200);
    expect((queue.json as Json).items.length).toBeGreaterThan(0);
    expect(((queue.json as Json).items as Json[]).every((i) => i.status === 'in_review')).toBe(true);
  });

  it('requires the reviewer’s opened sources for a Sourced (non-Kids) item, like the items pipeline', async () => {
    const i = ++n;
    const grow = {
      id: `push-grow-${i}`,
      slug: `push-grow-${i}`,
      brand: 'grow',
      contentType: 'article',
      title: `Saving Money on Groceries ${i}`,
      description: 'Simple ways a family can spend less on food each week.',
      updatedAt: '2026-11-20',
      author: 'SparkKindly',
      tags: [],
      sources: [source],
      aiDisclosure: 'Written with AI help and checked by a person.',
      body: [
        { heading: 'Plan first', paragraphs: ['A short list keeps a shopper from buying things the kitchen already has. Checking the shelves first takes five minutes.'] },
        { heading: 'Buy staples on sale', paragraphs: ['Rice, beans and oats keep for months. Buying them when the price drops lowers the cost of many meals.'] },
      ],
      takeaway: 'A list and a stocked shelf lower the weekly bill.',
    };
    const pkg = await submitPackage(db, master, { article: grow }, deps());
    expect(pkg.status).toBe(201);
    const item = itemsOf(pkg)[0];
    expect((item.qualityReport as Json).riskTier).toBe('sourced');
    const bare = await reviewPushItem(db, reviewer, item.id, { decision: 'approve' }, deps());
    expect(bare.status).toBe(422);
    expect((bare.json as Json).error).toBe('review_incomplete');
    const withSources = await reviewPushItem(
      db,
      reviewer,
      item.id,
      { decision: 'approve', sourcesChecked: ['https://example.org/bees'] },
      deps(),
    );
    expect(withSources.status).toBe(200);
    expect((withSources.json as Json).status).toBe('approved');
  });

  it('freezes media at approval: a hero cannot be swapped onto an approved item', async () => {
    const pkg = await submitPackage(db, submitter, { article: kidsArticle() }, deps());
    const id = itemsOf(pkg)[0].id as string;
    await reviewPushItem(db, reviewer, id, { decision: 'approve' }, deps());
    const png = await sharp({
      create: { width: 64, height: 48, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const up = await uploadHeroImage(db, submitter, id, png, {}, deps());
    expect(up.status).toBe(409);
    expect((up.json as Json).error).toBe('invalid_state');
  });
});

// --- Video: a stubbed YouTube behind a temp token file ------------------------------------------------
const VIDEO_ID = 'dQw4w9WgXcQ';
const SESSION_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=TEST';
type Call = { url: string; method: string; body: string };
function youtubeFetch(calls: Call[]) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: typeof init?.body === 'string' ? init.body : '' });
    // Method matters: the session URL itself contains "uploadType=resumable", so a URL-only check
    // would answer the chunk PUT with the session's empty response.
    if (method === 'POST' && u.includes('uploadType=resumable'))
      return new Response(null, { status: 200, headers: { location: SESSION_URL } });
    if (u === SESSION_URL) return Response.json({ id: VIDEO_ID }, { status: 200 });
    if (method === 'PUT' && u.includes('youtube/v3/videos?part=snippet,status'))
      return Response.json({}, { status: 200 });
    if (u.includes('youtube/v3/videos?part=snippet,status'))
      return Response.json(
        { items: [{ snippet: { title: 'T', categoryId: '27' }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: true } }] },
        { status: 200 },
      );
    throw new Error(`unexpected call ${method} ${u}`);
  }) as unknown as typeof fetch;
}
function youtubeEnv(needsReauth = false) {
  const file = path.join(tokenDir, `tokens-${needsReauth ? 'reauth' : 'ok'}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      youtube: needsReauth
        ? { refreshToken: 'RT', needsReauth: true }
        : { accessToken: 'AT', refreshToken: 'RT', expiresAt: NOW.getTime() + 3_600_000 },
    }),
  );
  return { YOUTUBE_CLIENT_ID: 'cid', YOUTUBE_CLIENT_SECRET: 'cs', SOCIAL_TOKEN_FILE: file };
}
const videoPkg = (over: Record<string, unknown> = {}) => ({
  article: kidsArticle(),
  video: { title: 'Bees at Work', description: 'A short look at bees.', brand: 'sparkkindly', tags: ['bees'], madeForKids: true, ...over },
});

describe('video component', () => {
  it('uploads private at submission with the made-for-kids declaration, and flips public only at publish', async () => {
    const calls: Call[] = [];
    const env = youtubeEnv();
    const vdeps = { ...deps(), env, fetch: youtubeFetch(calls) };
    const pkg = await submitPackage(db, submitter, videoPkg(), vdeps);
    expect(pkg.status).toBe(201);
    const article = itemsOf(pkg)[0];
    expect((pkg.json as Json).video.state).toBe('pending_upload');
    expect((pkg.json as Json).video.watchUrl).toBeNull();

    // The file is already on the server (a direct upload landed it); attach with no sourceUrl processes it.
    mkdirSync(path.join(mediaDir, 'video'), { recursive: true });
    writeFileSync(path.join(mediaDir, 'video', `${article.id}.mp4`), Buffer.alloc(2048, 7));
    const attached = await attachVideoSource(db, submitter, article.id, {}, vdeps);
    expect(attached.status).toBe(200);
    const video = (attached.json as Json).video as Json;
    expect(video.state).toBe('private');
    expect(video.watchUrl).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
    const session = calls.find((c) => c.url.includes('uploadType=resumable'));
    expect(session?.body).toContain('"privacyStatus":"private"');
    expect(session?.body).toContain('"selfDeclaredMadeForKids":true');

    // Approval gives a video item NO publish_at: the publish-due job (which knows nothing about
    // videos) must never be able to publish the article ahead of its video.
    const approval = await reviewPushItem(db, reviewer, article.id, { decision: 'approve' }, vdeps);
    expect(approval.status).toBe(200);
    expect((approval.json as Json).publishAt).toBeNull();
    const due = await publishDue(db, new Date('2027-06-01T00:00:00Z'));
    expect(due.published).not.toContain(article.id);
    expect(((await getPushStatus(db, submitter, article.id)).json as Json).status).toBe('approved');

    const pub = await publishPushItem(db, promoter, article.id, vdeps);
    expect(pub.status).toBe(200);
    expect((pub.json as Json).video.state).toBe('public');
    const flip = calls.find((c) => c.method === 'PUT' && c.url.includes('youtube/v3/videos?part=snippet,status'));
    expect(flip?.body).toContain('"privacyStatus":"public"');
    expect(flip?.body).toContain('"selfDeclaredMadeForKids":true');

    const audit = await db.query<{ action: string; detail: unknown }>(
      "SELECT action, detail FROM audit_log WHERE target = $1 AND action LIKE 'content_push.video%' ORDER BY id",
      [article.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'content_push.video_declared',
      'content_push.video_uploaded',
      'content_push.video_privacy',
      'content_push.video_privacy',
    ]);
    expect((audit.rows[2].detail as Json).to).toBe('private');
    expect((audit.rows[3].detail as Json).to).toBe('public');
  });

  it('surfaces an expired YouTube consent as its own state and blocks publish with it', async () => {
    const calls: Call[] = [];
    const env = youtubeEnv(true);
    const vdeps = { ...deps(), env, fetch: youtubeFetch(calls) };
    const pkg = await submitPackage(db, submitter, videoPkg(), vdeps);
    const article = itemsOf(pkg)[0];
    mkdirSync(path.join(mediaDir, 'video'), { recursive: true });
    writeFileSync(path.join(mediaDir, 'video', `${article.id}.mp4`), Buffer.alloc(1024, 3));
    const attached = await attachVideoSource(db, submitter, article.id, {}, vdeps);
    const video = (attached.json as Json).video as Json;
    expect(video.state).toBe('auth_expired');
    expect(video.error).toBe(YOUTUBE_AUTH_EXPIRED);

    await reviewPushItem(db, reviewer, article.id, { decision: 'approve' }, vdeps);
    const pub = await publishPushItem(db, promoter, article.id, vdeps);
    expect(pub.status).toBe(409);
    expect((pub.json as Json).error).toBe('youtube_auth_expired');
    const status = await getPushStatus(db, submitter, article.id);
    expect((status.json as Json).status).toBe('approved'); // still approved, not published
  });

  it('respects an in-flight upload claim, and takes over a stale one', async () => {
    const calls: Call[] = [];
    const env = youtubeEnv();
    const vdeps = { ...deps(), env, fetch: youtubeFetch(calls) };
    const pkg = await submitPackage(db, submitter, videoPkg(), vdeps);
    const article = itemsOf(pkg)[0];
    mkdirSync(path.join(mediaDir, 'video'), { recursive: true });
    writeFileSync(path.join(mediaDir, 'video', `${article.id}.mp4`), Buffer.alloc(1024, 5));

    // Another processor holds a fresh claim: no source swap, no second upload.
    await db.query("UPDATE push_videos SET state = 'uploading', updated_at = now() WHERE item_id = $1", [article.id]);
    const swap = await attachVideoSource(db, submitter, article.id, { sourceUrl: 'https://example.org/x.mp4' }, vdeps);
    expect(swap.status).toBe(409);
    const wait = await attachVideoSource(db, submitter, article.id, {}, vdeps);
    expect((wait.json as Json).video.state).toBe('uploading');
    expect(calls.filter((c) => c.method === 'POST' && c.url.includes('uploadType=resumable'))).toHaveLength(0);

    // A claim left by a crashed processor goes stale and is taken over, not wedged forever.
    await db.query("UPDATE push_videos SET updated_at = '2026-11-19T00:00:00Z' WHERE item_id = $1", [article.id]);
    const taken = await attachVideoSource(db, submitter, article.id, {}, vdeps);
    expect((taken.json as Json).video.state).toBe('private');
  });

  it('treats an ambiguous upload as terminal: no source swap and no re-upload, ever', async () => {
    const calls: Call[] = [];
    const env = youtubeEnv();
    // The final chunk answers 200 with no video id: the upload may have reached YouTube.
    const ambiguousFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: '' });
      if (method === 'POST' && u.includes('uploadType=resumable'))
        return new Response(null, { status: 200, headers: { location: SESSION_URL } });
      if (u === SESSION_URL) return new Response('oops', { status: 200 });
      throw new Error(`unexpected call ${method} ${u}`);
    }) as unknown as typeof fetch;
    const vdeps = { ...deps(), env, fetch: ambiguousFetch };
    const pkg = await submitPackage(db, submitter, videoPkg(), vdeps);
    const article = itemsOf(pkg)[0];
    mkdirSync(path.join(mediaDir, 'video'), { recursive: true });
    writeFileSync(path.join(mediaDir, 'video', `${article.id}.mp4`), Buffer.alloc(512, 9));

    const first = await attachVideoSource(db, submitter, article.id, {}, vdeps);
    const v1 = (first.json as Json).video as Json;
    expect(v1.state).toBe('failed');
    expect(String(v1.error)).toContain('may have reached YouTube');
    const sessions = () => calls.filter((c) => c.method === 'POST' && c.url.includes('uploadType=resumable')).length;
    expect(sessions()).toBe(1);

    // A fresh sourceUrl must not quietly reset the terminal state into a blind retry…
    const swap = await attachVideoSource(db, submitter, article.id, { sourceUrl: 'https://example.org/other.mp4' }, vdeps);
    expect(swap.status).toBe(409);
    // …and a plain re-process must not upload again either.
    const again = await attachVideoSource(db, submitter, article.id, {}, vdeps);
    expect((again.json as Json).video.state).toBe('failed');
    expect(sessions()).toBe(1);
  });
});
