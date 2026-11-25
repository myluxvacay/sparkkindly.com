import type { Db, Queryable } from '@/lib/db';
import type { EnvLike } from '@/lib/env';
import { contentFingerprint } from '@/lib/editorial-approval';
import { findBlockedTopic, findBlockedWord } from '@/lib/items/blocked';
import { fleschKincaidGrade } from '@/lib/items/readability';
import { isSafeSourceUrl } from '@/lib/items/net-safety';
import { httpsProbe, type Probe } from '@/lib/items/probe';
import {
  IllegalTransitionError,
  getItem,
  insertItem,
  transitionTx,
  type RiskTier,
  type Status,
  type StoredItem,
} from '@/lib/items/repo';
import { lockWorldSlots, nextSlot } from '@/lib/items/policy';
import { bandTopic, bandTopicsFor, CHILD_BANDS, LEGACY_BAND_TOPICS } from '@/lib/age-bands';

// Every topic slug that makes serving derive a child band for an item (canonical + the two legacy
// printables topics lib/age-bands.ts unifies). An item with none of these serves as 'family'.
const BAND_TOPIC_SLUGS = new Set([...CHILD_BANDS.map(bandTopic), ...Object.keys(LEGACY_BAND_TOPICS)]);
import { watchUrl } from '@/lib/items/video';
import { SocialPostError } from '@/lib/social/adapters/meta';
import { tokenStatus } from '@/lib/social/token-store';
import { setVideoPrivacy, uploadPushVideo, type YoutubePrivacy } from '@/lib/social/adapters/youtube';
import type { Agent } from './auth';
import type { ApiResult } from './api';
import { pushPackageSchema, reviewDecisionSchema, type PushArticle, type PushQuiz } from './content-push-format';
import {
  MAX_VIDEO_BYTES,
  fetchVideoToFile,
  pushMediaDir,
  storeHeroImage,
  storedVideoSize,
  videoFileName,
  videoPath,
} from './content-push-media';

// The Content Push API (docs/content-push-api.md, ADR 0006). Agents push LIBRARY-shaped packages
// (article + companion quizzes + optional hero image + optional video) and the server runs the whole
// pipeline the git path runs by hand: schema, gates, fingerprint registration, review, scheduling,
// publish. Items land in the same `items` table, mapped exactly as lib/items/import-legacy.ts maps the
// content files, so a pushed item renders identically to an imported one and the two coexist.
//
// Roles mirror the existing agents: a 'content' key submits (the submitter), a 'reviewer' key approves
// or rejects, a 'promoter' key publishes. Workflow vocabulary over the item statuses:
// draft -> in_review -> approved (stored: scheduled, publish_at = its slot/date) -> published; rejected
// is stored as-is. Nothing here ever touches content/*.json or the editorial-approval registry, so
// content:validate and the deploy gate for git content are unaffected by pushed items.

export type PushDeps = {
  probe?: Probe;
  now?: Date;
  env?: EnvLike;
  mediaDir?: string;
  fetch?: typeof fetch;
  // Who is acting, for audit rows written deep inside video processing (the attach caller, the
  // promoter at publish). Defaults to 'system' for a caller with no agent (a repair run).
  actor?: string;
};

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): ApiResult => ({
  status,
  json: { error, ...extra },
});

export const YOUTUBE_AUTH_EXPIRED = 'YouTube authorization expired — owner re-approval needed';
// The upload call that publishes is ambiguous when it fails (5B's rule): the video may exist on the
// channel, so this state is terminal for automation — a human checks the channel; nothing re-uploads.
const UPLOAD_AMBIGUOUS = 'the upload may have reached YouTube; check the channel before retrying (never re-upload blindly)';
const SLOT_HOUR_UTC = 6;
const QUIZ_DATE_LOCK = 7263003; // nextSlot owns 7263002 (per world); quiz dates are global, so they take their own lock
const MAX_KIDS_GRADE = 6; // lib/items/gates.ts, the Kids readability ceiling
const DUPLICATE_WINDOW_DAYS = 90;
const SIMILARITY_LIMIT = 0.8;
const SOURCE_BUDGET_MS = 20_000;
const PACKAGE_PROBE_BUDGET_MS = 60_000; // one shared source-probe budget across a whole package
const UPLOAD_CLAIM_STALE_MS = 30 * 60_000; // an 'uploading' claim older than this is a crashed processor

export const workflowStatus = (s: Status): string => (s === 'scheduled' ? 'approved' : s);

// The tier the item pipeline itself assigns (lib/items/gates.ts riskTierFor): the Kids brand is the
// Kids tier, and anything else carrying sources is Sourced — and a push item ALWAYS carries sources
// (the API requires them), so every non-Kids push item is Sourced and its approval needs the sources
// the reviewer opened, exactly as for an item that arrived any other way. (The legacy import's looser
// tiers are for already-published library files, not for new submissions.)
const tierFor = (brand: string): RiskTier => (brand === 'kids' ? 'kids' : 'sourced');
const audienceFor = (brand: string) => (brand === 'kids' ? 'kids' : 'all') as 'kids' | 'all';

// The stored hero for a package-supplied /images/ asset, built exactly as the import builds it
// (imageFor in lib/items/import-legacy.ts; keep the two in step).
function imageFor(hero: { src: string; alt: string; width: number; height: number; credit: string; rights: string }) {
  const stock = /unsplash/i.test(hero.credit);
  return {
    src: hero.src,
    alt: hero.alt,
    width: hero.width,
    height: hero.height,
    origin: stock ? 'stock' : 'owner-supplied',
    licence: stock ? 'https://unsplash.com/license' : hero.rights,
    credit: hero.credit,
    rights: hero.rights,
  };
}

function quizTitle(id: string): string {
  const words = id.replace(/-\d+$/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function audit(db: Queryable, actor: string, action: string, target: string, detail: Record<string, unknown>): Promise<void> {
  await db.query('INSERT INTO audit_log (actor, action, target, detail) VALUES ($1, $2, $3, $4::jsonb)', [
    actor,
    action,
    target,
    JSON.stringify(detail),
  ]);
}

// --- Gates ---------------------------------------------------------------------------------------------
// The push counterparts of lib/items/gates.ts, over the library shapes, reusing its primitives (blocked
// words/topics, readability, the vetted source probe). A gate failure never loses the submission: the
// item is stored as a draft with the failing checks in its quality report, and the submitter can fix and
// resubmit (its own draft is replaced). Hard format failures never get this far — the zod schemas refuse
// them with a 422 before anything is stored.

type GateResult = { gate: string; ok: boolean; reason?: string };
type GateOutcome = { ok: boolean; results: GateResult[]; excluded: boolean };

const words = (title: string) => new Set(title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
function jaccard(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared);
}

async function sourceProblem(url: string, probe: Probe, deadline: number): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    if (!isSafeSourceUrl(current)) return `not an allowed source address: ${current}`;
    const left = deadline - Date.now();
    if (left <= 0) return 'source checks ran out of time';
    let res = await probe(current, 'HEAD', AbortSignal.timeout(Math.min(5000, left)));
    if (res.status >= 400) {
      const left2 = deadline - Date.now();
      if (left2 <= 0) return 'source checks ran out of time';
      res = await probe(current, 'GET', AbortSignal.timeout(Math.min(5000, left2)));
    }
    if (res.status >= 200 && res.status < 300) return null;
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) return `redirect without a location: ${current}`;
      current = new URL(res.location, current).toString();
      continue;
    }
    return `source answered ${res.status}: ${current}`;
  }
  return `too many redirects: ${url}`;
}

async function runPushGates(
  db: Queryable,
  input: { worldId: number; slug: string; title: string; text: string; prose: string; brand: string; sources: { url: string }[] },
  deps: { probe: Probe; now: Date; ignoreItemId?: string; probeDeadline?: number },
): Promise<GateOutcome> {
  const results: GateResult[] = [];
  const run = async (gate: string, fn: () => Promise<{ ok: boolean; reason?: string }>) => {
    try {
      results.push({ gate, ...(await fn()) });
    } catch (err) {
      results.push({ gate, ok: false, reason: `could not run: ${(err as Error).message}` });
    }
  };

  await run('duplicate', async () => {
    const ignore = deps.ignoreItemId ?? null;
    const since = new Date(deps.now.getTime() - DUPLICATE_WINDOW_DAYS * 86_400_000).toISOString();
    const recent = await db.query<{ title: string }>(
      'SELECT title FROM items WHERE world_id = $1 AND created_at > $2::timestamptz AND ($3::uuid IS NULL OR id <> $3::uuid)',
      [input.worldId, since, ignore],
    );
    const near = recent.rows.find((r) => jaccard(r.title, input.title) >= SIMILARITY_LIMIT);
    return near
      ? { ok: false, reason: `the title is too similar to "${near.title}" (already in the library)` }
      : { ok: true };
  });

  await run('blocked-words', async () => {
    const hit = findBlockedWord(input.text);
    return hit ? { ok: false, reason: 'contains a blocked word' } : { ok: true };
  });

  let excluded = false;
  await run('blocked-topics', async () => {
    const hit = findBlockedTopic(input.text);
    if (hit) excluded = true;
    return hit ? { ok: false, reason: `touches an excluded topic: ${hit}` } : { ok: true };
  });

  await run('sources', async () => {
    const deadline = deps.probeDeadline ?? Date.now() + SOURCE_BUDGET_MS;
    for (const s of input.sources) {
      const problem = await sourceProblem(s.url, deps.probe, deadline).catch(
        (err: Error) => `could not reach ${s.url}: ${err.message}`,
      );
      if (problem) return { ok: false, reason: problem };
    }
    return { ok: true };
  });

  await run('kids-readability', async () => {
    if (input.brand !== 'kids') return { ok: true };
    const grade = fleschKincaidGrade(input.prose);
    return grade > MAX_KIDS_GRADE
      ? { ok: false, reason: `reading grade ${grade.toFixed(1)} is above the Kids limit of ${MAX_KIDS_GRADE}` }
      : { ok: true };
  });

  return { ok: results.every((r) => r.ok), results, excluded };
}

// --- Submission ----------------------------------------------------------------------------------------

type World = { id: number; slug: string };

async function resolveBrandWorld(db: Queryable, brand: string): Promise<World | null> {
  const r = await db.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds WHERE slug = $1 AND enabled', [brand]);
  return r.rows[0] ?? null;
}

type ItemPlan = {
  kind: 'article' | 'quiz';
  libraryId: string;
  slug: string;
  fingerprint: string;
  article?: PushArticle;
  quiz?: PushQuiz;
};

const articleProse = (a: PushArticle): string =>
  [a.description, ...a.body.flatMap((s) => s.paragraphs), a.takeaway].map((p) => (/[.!?]$/.test(p.trim()) ? p : `${p}.`)).join(' ');
const quizProse = (q: PushQuiz): string =>
  [q.prompt, q.explanation].map((p) => (/[.!?]$/.test(p.trim()) ? p : `${p}.`)).join(' ');

// Every string in the submitted item, recursively (the blocked gates scan this, as lib/items/gates.ts
// allText does for the items API): byline, disclosure, the Kids fields, image text, source titles — a
// field added to the format later is covered by default, not by remembering to list it.
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

type PushVideoRow = {
  id: string;
  item_id: string;
  state: string;
  youtube_id: string | null;
  privacy_status: string | null;
  source_url: string | null;
  file_name: string | null;
  title: string;
  description: string;
  brand: string;
  tags: unknown;
  made_for_kids: boolean;
  error: string | null;
};

const videoView = (v: PushVideoRow | null) =>
  v
    ? {
        state: v.state,
        youtubeId: v.youtube_id,
        watchUrl: v.youtube_id ? watchUrl(v.youtube_id) : null,
        privacyStatus: v.privacy_status,
        brand: v.brand,
        madeForKids: v.made_for_kids,
        error: v.error,
      }
    : null;

async function videoRowFor(db: Queryable, itemId: string): Promise<PushVideoRow | null> {
  const r = await db.query<PushVideoRow>('SELECT * FROM push_videos WHERE item_id = $1', [itemId]);
  return r.rows[0] ?? null;
}

// For the routes, which check a video exists (and its state) before reading an upload body.
export const getPushVideoRow = (db: Queryable, itemId: string): Promise<PushVideoRow | null> => videoRowFor(db, itemId);

// Media is part of what the reviewer approves: once an item leaves draft/in_review its hero and video
// are frozen, so what was reviewed is what publishes.
const mediaEditable = (item: StoredItem): boolean => item.status === 'draft' || item.status === 'in_review';
const mediaFrozen = (item: StoredItem): ApiResult =>
  fail(409, 'invalid_state', {
    message: `Media cannot change once an item is ${workflowStatus(item.status)}; what the reviewer approved is what publishes.`,
  });

function itemView(i: StoredItem, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const report = (i.qualityReport ?? {}) as { push?: { fingerprint?: string } };
  return {
    id: i.id,
    kind: i.kind,
    slug: i.slug,
    status: workflowStatus(i.status),
    itemStatus: i.status,
    fingerprint: report.push?.fingerprint ?? i.idempotencyKey,
    publishAt: i.publishAt ? i.publishAt.toISOString() : null,
    scheduledDate: i.kind === 'quiz' && i.publishAt ? i.publishAt.toISOString().slice(0, 10) : null,
    qualityReport: i.qualityReport,
    ...extra,
  };
}

export async function submitPackage(db: Db, agent: Agent, body: unknown, deps: PushDeps = {}): Promise<ApiResult> {
  if (agent.role !== 'content') return fail(403, 'forbidden_role', { message: 'Only a submitter (content) key can push a package.' });
  const now = deps.now ?? new Date();
  const probe = deps.probe ?? httpsProbe;
  const parsed = pushPackageSchema.safeParse(body);
  if (!parsed.success) {
    return fail(422, 'invalid_package', {
      issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const pkg = parsed.data;
  const brand = pkg.article?.brand ?? pkg.quizzes![0].brand;
  if (pkg.quizzes?.some((q) => q.brand !== brand))
    return fail(422, 'mixed_brands', { message: 'Every item in a package shares the article brand (the world it lands in).' });
  const world = await resolveBrandWorld(db, brand);
  if (!world) return fail(422, 'unknown_world', { message: `There is no enabled world called "${brand}".` });

  const plans: ItemPlan[] = [];
  if (pkg.article)
    plans.push({
      kind: 'article',
      libraryId: pkg.article.id,
      slug: pkg.article.slug,
      fingerprint: contentFingerprint({ kind: 'article', ...pkg.article }),
      article: pkg.article,
    });
  for (const q of pkg.quizzes ?? [])
    plans.push({ kind: 'quiz', libraryId: q.id, slug: q.id, fingerprint: contentFingerprint({ kind: 'quiz', ...q }), quiz: q });

  // Idempotency: the fingerprint IS the key. A plan whose fingerprint this agent already stored is a
  // replay — return the stored record, never a second copy.
  const resolved: { plan: ItemPlan; existing?: StoredItem; replace?: StoredItem }[] = [];
  for (const plan of plans) {
    const replay = await db.query<{ id: string }>('SELECT id FROM items WHERE agent_id = $1 AND idempotency_key = $2', [
      agent.id,
      plan.fingerprint,
    ]);
    if (replay.rows[0]) {
      const stored = await getItem(db, replay.rows[0].id);
      if (stored) {
        resolved.push({ plan, existing: stored });
        continue;
      }
    }
    const clash = await db.query<{ id: string; agent_id: number | null; status: string }>(
      "SELECT id, agent_id, status FROM items WHERE world_id = $1 AND locale = 'en' AND slug = $2",
      [world.id, plan.slug],
    );
    const holder = clash.rows[0];
    if (holder && !(holder.agent_id === agent.id && holder.status === 'draft')) {
      return fail(409, 'slug_taken', { message: `The slug "${plan.slug}" is already used in ${brand}.` });
    }
    const replace = holder ? ((await getItem(db, holder.id)) ?? undefined) : undefined;
    resolved.push({ plan, replace });
  }

  // Gates run before anything is stored, outside the insert transaction (they probe the network). One
  // probe deadline is shared across the whole package, so a 21-item package of slow sources cannot
  // hold the request open item after item.
  const probeDeadline = Date.now() + PACKAGE_PROBE_BUDGET_MS;
  const gated = new Map<string, GateOutcome>();
  for (const { plan, existing, replace } of resolved) {
    if (existing) continue;
    const a = plan.article;
    const q = plan.quiz;
    gated.set(
      plan.fingerprint,
      await runPushGates(
        db,
        {
          worldId: world.id,
          slug: plan.slug,
          title: a ? a.title : quizTitle(plan.libraryId),
          text: collectStrings(a ?? q).join('\n'),
          prose: a ? articleProse(a) : quizProse(q!),
          brand,
          sources: (a ? a.sources : q!.sources).map((s) => ({ url: s.url })),
        },
        { probe, now, ignoreItemId: replace?.id, probeDeadline },
      ),
    );
  }

  // Topics: article tags that name a curated topic link as topics; the rest stay library tags, recorded
  // in the quality report (the legacy import links them the same way — by topic match only). The age-band
  // topics come from each item's own ageBands (bandTopicsFor), NOT from tags: serving derives an item's
  // bands from its linked ages-* topics (lib/items/repo.ts toPublic), so a pushed item without them
  // would silently serve as 'family' to everyone.
  const articleTags = pkg.article?.tags ?? [];
  const knownTopics = articleTags.length
    ? (await db.query<{ slug: string }>('SELECT slug FROM topics WHERE slug = ANY($1)', [articleTags])).rows.map((r) => r.slug)
    : [];
  const articleTopics = [...new Set([...knownTopics, ...bandTopicsFor(pkg.article?.ageBands)])];
  const packageFingerprint = contentFingerprint(pkg);

  let created: { plan: ItemPlan; stored: StoredItem; replayed: boolean }[] = [];
  try {
    created = await db.transaction(async (tx) => {
      const out: { plan: ItemPlan; stored: StoredItem; replayed: boolean }[] = [];
      for (const { plan, existing, replace } of resolved) {
        if (existing) {
          out.push({ plan, stored: existing, replayed: true });
          continue;
        }
        const gates = gated.get(plan.fingerprint)!;
        const tier: RiskTier = gates.excluded ? 'excluded' : tierFor(brand);
        const report = {
          push: {
            fingerprint: plan.fingerprint,
            packageFingerprint,
            libraryId: plan.libraryId,
            submittedBy: agent.name,
            submittedAt: now.toISOString(),
            // The bands as submitted, kept beside the linked topics: the approval gate reads this to
            // tell a deliberate 'family'-only item (which links no band topics, by design) from a
            // bandless row that predates the ageBands requirement.
            ageBands: (plan.article ?? plan.quiz)!.ageBands,
            ...(plan.kind === 'article' ? { tags: articleTags, unlinkedTags: articleTags.filter((t) => !knownTopics.includes(t)) } : {}),
          },
          riskTier: tier,
          gates: gates.results,
        };
        if (replace) await tx.query("DELETE FROM items WHERE id = $1 AND status = 'draft' AND agent_id = $2", [replace.id, agent.id]);
        let stored: StoredItem;
        if (plan.article) {
          const a = plan.article;
          stored = await insertItem(tx, {
            worldId: world.id,
            kind: 'article',
            slug: a.slug,
            title: a.title,
            summary: a.description,
            body: {
              sections: a.body,
              takeaway: a.takeaway,
              fiction: a.fiction,
              byline: a.author,
              aiDisclosure: a.aiDisclosure,
              legacyContentType: a.contentType,
              ageGuidance: a.ageGuidance,
              materials: a.materials,
              supervision: a.supervision,
              safetyNotes: a.safetyNotes,
              screenFreeExtension: a.screenFreeExtension,
              correctionNote: a.correctionNote,
            },
            audience: audienceFor(brand),
            status: 'draft',
            createdBy: agent.name,
            agentId: agent.id,
            riskTier: tier,
            sources: a.sources,
            qualityReport: report,
            image: a.hero ? imageFor(a.hero) : { origin: 'template' },
            topics: articleTopics,
            answer: null,
            idempotencyKey: plan.fingerprint,
          });
        } else {
          const q = plan.quiz!;
          stored = await insertItem(tx, {
            worldId: world.id,
            kind: 'quiz',
            slug: q.id,
            title: quizTitle(q.id),
            summary: q.prompt,
            body: {
              mechanic: 'multiple_choice',
              prompt: q.prompt,
              ...(q.ageGuidance
                ? {
                    ageGuidance: q.ageGuidance,
                    materials: q.materials,
                    supervision: q.supervision,
                    safetyNotes: q.safetyNotes,
                    screenFreeExtension: q.screenFreeExtension,
                  }
                : {}),
              ...(q.passage ? { passage: q.passage, passageTitle: q.passageTitle, setId: q.setId } : {}),
              ...(q.hero ? { passageImage: { src: q.hero.src, alt: q.hero.alt } } : {}),
              options: q.options.map((o) => ({ id: o.id, text: o.text })),
              difficulty: q.difficulty,
            },
            audience: audienceFor(brand),
            status: 'draft',
            createdBy: agent.name,
            agentId: agent.id,
            riskTier: tier,
            sources: q.sources,
            qualityReport: report,
            image: q.hero ? imageFor(q.hero) : { origin: 'template' },
            topics: bandTopicsFor(q.ageBands),
            answer: { value: q.correctOptionId, explanation: q.explanation },
            idempotencyKey: plan.fingerprint,
          });
        }
        if (gates.ok) {
          stored = await transitionTx(tx, stored.id, 'in_review', agent.name, 'content push: submitted for review');
        }
        await audit(tx, agent.name, 'content_push.submit', stored.id, {
          kind: plan.kind,
          slug: plan.slug,
          fingerprint: plan.fingerprint,
          status: workflowStatus(stored.status),
          gatesOk: gates.ok,
        });
        out.push({ plan, stored, replayed: false });
      }
      return out;
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      // A simultaneous submission won a unique race: if it was THIS package (same fingerprints), its
      // records are the answer; otherwise the slug was taken between the check and the insert.
      const winners: StoredItem[] = [];
      for (const plan of plans) {
        const r = await db.query<{ id: string }>('SELECT id FROM items WHERE agent_id = $1 AND idempotency_key = $2', [
          agent.id,
          plan.fingerprint,
        ]);
        const stored = r.rows[0] ? await getItem(db, r.rows[0].id) : null;
        if (!stored) break;
        winners.push(stored);
      }
      if (winners.length === plans.length) {
        const video = pkg.video ? await videoRowFor(db, winners.find((w) => w.kind === 'article')!.id) : null;
        return {
          status: 200,
          json: {
            packageFingerprint,
            world: brand,
            items: winners.map((w) => ({ ...itemView(w), world: brand, replayed: true })),
            ...(pkg.video ? { video: videoView(video) } : {}),
          },
        };
      }
      return fail(409, 'slug_taken', { message: 'A slug in this package was just taken by another submission.' });
    }
    throw err;
  }

  // The video component's record rides on the article's row. It is declared only while the article is
  // still editable (draft/in_review): a replay of an already-approved package cannot sprout a video
  // the reviewer never saw. ON CONFLICT keeps two simultaneous identical submissions from racing the
  // insert into a 500 — the row either of them made is the row both report.
  let video: PushVideoRow | null = null;
  if (pkg.video) {
    const articleEntry = created.find((c) => c.plan.kind === 'article')!;
    video = await videoRowFor(db, articleEntry.stored.id);
    if (!video && (articleEntry.stored.status === 'draft' || articleEntry.stored.status === 'in_review')) {
      const v = pkg.video;
      const r = await db.query<PushVideoRow>(
        `INSERT INTO push_videos (item_id, state, source_url, title, description, brand, tags, made_for_kids)
         VALUES ($1, 'pending_upload', $2, $3, $4, $5, $6::jsonb, $7) ON CONFLICT (item_id) DO NOTHING RETURNING *`,
        [articleEntry.stored.id, v.sourceUrl ?? null, v.title, v.description, v.brand, JSON.stringify(v.tags), v.madeForKids],
      );
      if (r.rows[0]) {
        video = r.rows[0];
        await audit(db, agent.name, 'content_push.video_declared', articleEntry.stored.id, { title: v.title, brand: v.brand });
      } else {
        video = await videoRowFor(db, articleEntry.stored.id);
      }
    }
  }

  const anyNew = created.some((c) => !c.replayed);
  return {
    status: anyNew ? 201 : 200,
    json: {
      packageFingerprint,
      world: brand,
      items: created.map((c) => ({ ...itemView(c.stored), world: brand, replayed: c.replayed })),
      ...(pkg.video ? { video: videoView(video) } : {}),
    },
  };
}

// --- Reads ---------------------------------------------------------------------------------------------

async function loadPushItem(db: Queryable, agent: Agent, id: string): Promise<StoredItem | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const item = await getItem(db, id);
  if (!item) return null;
  const report = (item.qualityReport ?? {}) as { push?: unknown };
  if (!report.push) return null; // not a pushed item; the items API is its surface
  if (agent.worldId !== null && item.worldId !== agent.worldId) return null;
  return item;
}

// A pushed item this agent may WRITE: it must be a push item, visible to the agent, and either the
// agent's own submission or reached through a master key (worldId null). Routes that read a large body
// (image, video file) call this BEFORE reading it, so a refused upload costs no bandwidth.
export async function loadOwnedPushItem(
  db: Queryable,
  agent: Agent,
  id: string,
): Promise<{ item: StoredItem } | { error: ApiResult }> {
  const item = await loadPushItem(db, agent, id);
  if (!item) return { error: fail(404, 'not_found') };
  if (item.agentId !== agent.id && agent.worldId !== null)
    return { error: fail(403, 'forbidden_item', { message: 'Only the submitting agent (or a master key) can change this item.' }) };
  return { item };
}

async function worldSlug(db: Queryable, worldId: number): Promise<string> {
  const r = await db.query<{ slug: string }>('SELECT slug FROM worlds WHERE id = $1', [worldId]);
  return r.rows[0]?.slug ?? '';
}

export async function getPushStatus(db: Db, agent: Agent, id: string): Promise<ApiResult> {
  const item = await loadPushItem(db, agent, id);
  if (!item) return fail(404, 'not_found');
  const video = await videoRowFor(db, item.id);
  return {
    status: 200,
    json: { ...itemView(item), world: await worldSlug(db, item.worldId), ...(video ? { video: videoView(video) } : {}) },
  };
}

export async function listPushQueue(
  db: Db,
  agent: Agent,
  filter: { status?: string; limit?: number } = {},
): Promise<ApiResult> {
  const limit = Math.min(50, Math.max(1, filter.limit ?? 20));
  const params: unknown[] = [];
  let where = "quality_report ? 'push'";
  if (agent.worldId !== null) {
    params.push(agent.worldId);
    where += ` AND world_id = $${params.length}`;
  }
  const wanted = filter.status ? (filter.status === 'approved' ? 'scheduled' : filter.status) : null;
  if (wanted) {
    params.push(wanted);
    where += ` AND status = $${params.length}`;
  }
  params.push(limit);
  const r = await db.query<{ id: string }>(
    `SELECT id FROM items WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  const items: Record<string, unknown>[] = [];
  for (const row of r.rows) {
    const item = await getItem(db, row.id);
    if (item) items.push({ ...itemView(item), world: await worldSlug(db, item.worldId) });
  }
  return { status: 200, json: { items } };
}

// --- Hero image ----------------------------------------------------------------------------------------

export async function uploadHeroImage(
  db: Db,
  agent: Agent,
  id: string,
  bytes: Uint8Array,
  meta: { alt?: string; credit?: string; rights?: string },
  deps: PushDeps = {},
): Promise<ApiResult> {
  if (agent.role !== 'content') return fail(403, 'forbidden_role', { message: 'Only a submitter (content) key can upload a hero.' });
  const owned = await loadOwnedPushItem(db, agent, id);
  if ('error' in owned) return owned.error;
  const item = owned.item;
  if (!mediaEditable(item)) return mediaFrozen(item);
  if (bytes.length === 0) return fail(422, 'invalid_image', { message: 'The upload is empty.' });
  let stored: { src: string; width: number; height: number };
  try {
    stored = await storeHeroImage(deps.mediaDir ?? pushMediaDir(deps.env ?? process.env), item.id, bytes);
  } catch {
    return fail(422, 'invalid_image', { message: 'The upload is not a PNG, JPEG or WebP image.' });
  }
  const image = {
    src: stored.src,
    alt: meta.alt ?? item.title,
    width: stored.width,
    height: stored.height,
    origin: 'generated',
    licence: meta.rights ?? 'SparkKindly',
    credit: meta.credit ?? 'AI-generated image · SparkKindly',
    rights: meta.rights ?? 'SparkKindly',
  };
  await db.query('UPDATE items SET image = $1::jsonb, updated_at = now() WHERE id = $2', [JSON.stringify(image), item.id]);
  await audit(db, agent.name, 'content_push.image', item.id, { src: stored.src, width: stored.width, height: stored.height });
  return { status: 200, json: { id: item.id, image } };
}

// --- Video ---------------------------------------------------------------------------------------------

type YoutubeState = 'ok' | 'reauth' | 'missing' | 'unavailable';

function youtubeAuthState(env: EnvLike): YoutubeState {
  if (!(env.YOUTUBE_CLIENT_ID ?? '').trim() || !(env.YOUTUBE_CLIENT_SECRET ?? '').trim()) return 'missing';
  return tokenStatus('youtube', env);
}

const videoDeps = (deps: PushDeps) => ({
  fetch: deps.fetch ?? fetch,
  env: deps.env ?? process.env,
  now: () => deps.now ?? new Date(),
});

async function setVideoState(db: Queryable, itemId: string, patch: Partial<PushVideoRow> & { state: string }): Promise<PushVideoRow> {
  const sets: string[] = [];
  const params: unknown[] = [itemId];
  for (const [key, value] of Object.entries(patch)) {
    params.push(value as never);
    sets.push(`${key} = $${params.length}`);
  }
  const r = await db.query<PushVideoRow>(
    `UPDATE push_videos SET ${sets.join(', ')}, updated_at = now() WHERE item_id = $1 RETURNING *`,
    params,
  );
  return r.rows[0];
}

// Brings the item's video to "uploaded, private" if it is not there. Never throws for a YouTube-side
// problem: the outcome is written on the row (state + error) and returned, so the caller decides whether
// it blocks (publish does; a bare process call just reports).
//
// Two guards keep the never-upload-twice rule honest. The row is CLAIMED with one atomic update into
// the 'uploading' state, so two processors (an attach racing a publish) cannot both upload. And the
// moment an upload succeeds its YouTube id is written on its own, before anything else: if the process
// dies after that, the id on the row is proof the video exists, and the next run heals the state from
// it instead of uploading a duplicate.
export async function processVideo(db: Db, item: StoredItem, deps: PushDeps = {}): Promise<PushVideoRow> {
  const env = deps.env ?? process.env;
  const dir = deps.mediaDir ?? pushMediaDir(env);
  const actor = deps.actor ?? 'system';
  let row = await videoRowFor(db, item.id);
  if (!row) throw new Error('the item has no video component');
  if (row.state === 'private' || row.state === 'public') return row;
  if (row.state === 'failed' && row.error === UPLOAD_AMBIGUOUS) return row;
  if (row.youtube_id) {
    // Self-heal: a previous run uploaded this video and recorded its id, but never marked it private.
    await db.query('UPDATE items SET video_youtube_id = $1, updated_at = now() WHERE id = $2', [row.youtube_id, item.id]);
    return setVideoState(db, item.id, { state: 'private', privacy_status: 'private', error: null });
  }

  // A claim older than the threshold is a crashed processor, not a live one (a fetch is capped at
  // five minutes and every YouTube call times out well inside this), so it may be taken over —
  // otherwise one crash would wedge the video in 'uploading' forever.
  const staleBefore = new Date((deps.now ?? new Date()).getTime() - UPLOAD_CLAIM_STALE_MS).toISOString();
  const claim = await db.query<PushVideoRow>(
    `UPDATE push_videos SET state = 'uploading', updated_at = now()
     WHERE item_id = $1 AND (state IN ('pending_upload', 'failed', 'auth_expired')
       OR (state = 'uploading' AND updated_at < $2::timestamptz)) RETURNING *`,
    [item.id, staleBefore],
  );
  if (!claim.rows[0]) return row; // another processor holds it, or the state does not process
  row = claim.rows[0];

  if ((await storedVideoSize(dir, item.id)) === null) {
    if (!row.source_url) {
      return setVideoState(db, item.id, { state: 'failed', error: 'no video file yet: give a sourceUrl or upload the file' });
    }
    const fetched = await fetchVideoToFile(row.source_url, videoPath(dir, item.id));
    if ('error' in fetched) return setVideoState(db, item.id, { state: 'failed', error: fetched.error });
    row = await setVideoState(db, item.id, { state: 'uploading', file_name: videoFileName(item.id) });
  }

  const auth = youtubeAuthState(env);
  if (auth === 'reauth') {
    await audit(db, actor, 'content_push.video_auth_expired', item.id, {});
    return setVideoState(db, item.id, { state: 'auth_expired', error: YOUTUBE_AUTH_EXPIRED });
  }
  if (auth !== 'ok') {
    return setVideoState(db, item.id, {
      state: 'failed',
      error: auth === 'missing' ? 'YouTube is not configured on this server (no client credentials or token)' : 'the YouTube token store is unavailable',
    });
  }

  const size = await storedVideoSize(dir, item.id);
  let youtubeId: string;
  try {
    youtubeId = await uploadPushVideo(videoDeps(deps), {
      filePath: videoPath(dir, item.id),
      size: size ?? 0,
      title: row.title,
      description: row.description,
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
      privacyStatus: 'private',
      madeForKids: row.made_for_kids,
    });
  } catch (err) {
    if (err instanceof SocialPostError && err.kind === 'credentials') {
      await audit(db, actor, 'content_push.video_auth_expired', item.id, {});
      return setVideoState(db, item.id, { state: 'auth_expired', error: YOUTUBE_AUTH_EXPIRED });
    }
    const message =
      err instanceof SocialPostError ? (err.kind === 'ambiguous' ? UPLOAD_AMBIGUOUS : err.message) : 'the upload failed';
    return setVideoState(db, item.id, { state: 'failed', error: message });
  }
  // The id goes on record FIRST and alone (see the header): from here a failure is a state problem,
  // never a reason to upload again.
  await db.query('UPDATE push_videos SET youtube_id = $1, updated_at = now() WHERE item_id = $2', [youtubeId, item.id]);
  await db.query('UPDATE items SET video_youtube_id = $1, updated_at = now() WHERE id = $2', [youtubeId, item.id]);
  const done = await setVideoState(db, item.id, { state: 'private', privacy_status: 'private', error: null });
  await audit(db, actor, 'content_push.video_uploaded', item.id, { youtubeId });
  await audit(db, actor, 'content_push.video_privacy', item.id, { to: 'private', youtubeId });
  return done;
}

export async function attachVideoSource(
  db: Db,
  agent: Agent,
  id: string,
  input: { sourceUrl?: string },
  deps: PushDeps = {},
): Promise<ApiResult> {
  if (agent.role !== 'content') return fail(403, 'forbidden_role', { message: 'Only a submitter (content) key can attach a video.' });
  const owned = await loadOwnedPushItem(db, agent, id);
  if ('error' in owned) return owned.error;
  const item = owned.item;
  if (!mediaEditable(item)) return mediaFrozen(item);
  let row = await videoRowFor(db, item.id);
  if (!row) return fail(404, 'no_video', { message: 'This item has no video component; declare one in the package.' });
  if (input.sourceUrl) {
    // A new source may only replace a video that never reached YouTube. An uploaded video's source is
    // settled, and an ambiguous upload is terminal: resetting its state here would quietly turn the
    // never-re-upload rule into a blind retry and a duplicate video on the channel. A row another
    // processor is uploading from is likewise untouchable: resetting it would defeat the claim and
    // let two processors upload at once.
    if (row.youtube_id)
      return fail(409, 'invalid_state', { message: 'The video is already on YouTube; its source cannot be replaced.' });
    if (row.state === 'uploading')
      return fail(409, 'invalid_state', { message: 'A video upload is already in progress for this item.' });
    if (row.state === 'failed' && row.error === UPLOAD_AMBIGUOUS)
      return fail(409, 'video_upload_failed', { message: UPLOAD_AMBIGUOUS });
    row = await setVideoState(db, item.id, { state: 'pending_upload', source_url: input.sourceUrl, error: null });
  }
  const done = await processVideo(db, item, { ...deps, actor: agent.name });
  return { status: 200, json: { id: item.id, video: videoView(done) } };
}

// Called by the video route after a direct file upload has been streamed to the media dir (the route
// checks ownership, the item's state and the video row with loadOwnedPushItem/getPushVideoRow before
// reading the body, so the refusals below are the second line, not the first).
export async function processUploadedVideo(db: Db, agent: Agent, id: string, deps: PushDeps = {}): Promise<ApiResult> {
  const owned = await loadOwnedPushItem(db, agent, id);
  if ('error' in owned) return owned.error;
  const item = owned.item;
  if (!mediaEditable(item)) return mediaFrozen(item);
  const row = await videoRowFor(db, item.id);
  if (!row) return fail(404, 'no_video', { message: 'This item has no video component; declare one in the package.' });
  if (row.youtube_id || row.state === 'private' || row.state === 'public')
    return fail(409, 'invalid_state', { message: 'The video is already on YouTube; its file cannot be replaced.' });
  if (row.state === 'uploading')
    return fail(409, 'invalid_state', { message: 'A video upload is already in progress for this item.' });
  await setVideoState(db, item.id, { state: row.state, file_name: videoFileName(item.id) });
  const done = await processVideo(db, item, { ...deps, actor: agent.name });
  return { status: 200, json: { id: item.id, video: videoView(done) } };
}

export { MAX_VIDEO_BYTES };

// --- Review --------------------------------------------------------------------------------------------

async function nextQuizDate(tx: Queryable, now: Date): Promise<{ date: string; at: Date }> {
  await tx.query('SELECT pg_advisory_xact_lock($1)', [QUIZ_DATE_LOCK]);
  const r = await tx.query<{ latest: string | null }>(
    `SELECT max((publish_at AT TIME ZONE 'UTC')::date)::text AS latest FROM items
     WHERE kind = 'quiz' AND publish_at IS NOT NULL AND status IN ('scheduled', 'published')`,
  );
  const today = now.toISOString().slice(0, 10);
  const base = r.rows[0]?.latest && r.rows[0].latest > today ? r.rows[0].latest : today;
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const date = d.toISOString().slice(0, 10);
  return { date, at: new Date(`${date}T0${SLOT_HOUR_UTC}:00:00Z`) };
}

export async function reviewPushItem(db: Db, agent: Agent, id: string, body: unknown, deps: PushDeps = {}): Promise<ApiResult> {
  if (agent.role !== 'reviewer') return fail(403, 'forbidden_role', { message: 'Only a reviewer key can review a pushed item.' });
  const parsed = reviewDecisionSchema.safeParse(body);
  if (!parsed.success)
    return fail(422, 'invalid_decision', { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })) });
  const decision = parsed.data;
  const item = await loadPushItem(db, agent, id);
  if (!item) return fail(404, 'not_found');
  if (item.status !== 'in_review')
    return fail(409, 'invalid_state', { message: `Only an in_review item can be reviewed; this one is ${workflowStatus(item.status)}.` });

  if (decision.decision === 'reject') {
    if (!decision.reason) return fail(422, 'reason_required', { message: 'A rejection needs a reason the submitter can act on.' });
    let stored: StoredItem;
    try {
      stored = await db.transaction(async (tx) => {
        const moved = await transitionTx(tx, item.id, 'rejected', agent.name, `content push review: ${decision.reason}`);
        const report = { ...((moved.qualityReport ?? {}) as Record<string, unknown>) };
        report.push = {
          ...((report.push ?? {}) as Record<string, unknown>),
          review: { decision: 'reject', reason: decision.reason, by: agent.name, at: (deps.now ?? new Date()).toISOString() },
        };
        await tx.query('UPDATE items SET quality_report = $1::jsonb WHERE id = $2', [JSON.stringify(report), item.id]);
        await audit(tx, agent.name, 'content_push.review_reject', item.id, { reason: decision.reason });
        return { ...moved, qualityReport: report };
      });
    } catch (err) {
      if (err instanceof IllegalTransitionError)
        return fail(409, 'invalid_state', { message: 'The item changed state while it was being reviewed; read it again.' });
      throw err;
    }
    return { status: 200, json: { ...itemView(stored), world: await worldSlug(db, item.worldId) } };
  }

  // Age-band gate (belt-and-braces): serving derives an item's bands from its linked ages-* topics,
  // so an item with NO band topic linked publishes as 'family' for everyone. Submissions now always
  // link their bands, and a deliberate family-only submission records ageBands: ['family'] in its
  // push report (it links no topics by design) — anything else with no band topic, e.g. a draft row
  // stored before ageBands was required on this API, is refused rather than approved bandless.
  const topicRows = await db.query<{ slug: string }>(
    'SELECT t.slug FROM item_topics it JOIN topics t ON t.id = it.topic_id WHERE it.item_id = $1',
    [item.id],
  );
  const recordedBands = ((item.qualityReport ?? {}) as { push?: { ageBands?: unknown } }).push?.ageBands;
  const declaredFamilyOnly =
    Array.isArray(recordedBands) && recordedBands.length > 0 && recordedBands.every((b) => b === 'family');
  if (!topicRows.rows.some((r) => BAND_TOPIC_SLUGS.has(r.slug)) && !declaredFamilyOnly)
    return fail(422, 'missing_age_bands', {
      message:
        'This item has no age-band topics linked, so approving it would publish it as family for everyone. Re-submit it with ageBands (or link its band topics) before approval.',
    });

  // An approval has to show its work for the item's tier, exactly as a contribution verdict does
  // (lib/agents/verdict.ts): a Sourced item needs the sources the reviewer actually opened, a
  // Computable item the answer the reviewer reached on their own.
  if (item.riskTier === 'sourced' && !decision.sourcesChecked?.length)
    return fail(422, 'review_incomplete', { message: 'A Sourced item cannot be approved without the sources the reviewer opened (sourcesChecked).' });
  if (item.riskTier === 'computable' && !decision.solvedAnswer)
    return fail(422, 'review_incomplete', { message: 'A Computable item cannot be approved without the reviewer’s own solved answer (solvedAnswer).' });

  const now = deps.now ?? new Date();
  let stored: StoredItem;
  try {
    stored = await db.transaction(async (tx) => {
      await lockWorldSlots(tx, item.worldId);
      // An item with a video is approved WITHOUT a publish_at. The publish-due job takes every
      // scheduled item whose publish_at has arrived, and it knows nothing about videos: giving a
      // video item a slot would let the job publish the article while its video is still private,
      // pending or auth-expired, past the publish endpoint's gate. With no slot, a video item goes
      // public only through the publish endpoint, after the flip — the owner's rule, enforced by the
      // absence of the one field the job reads.
      const videoRow = item.kind === 'article' ? await videoRowFor(tx, item.id) : null;
      let publishAt: Date | null;
      if (item.kind === 'quiz') {
        const slot = await nextQuizDate(tx, now);
        publishAt = slot.at;
        const bodyObj = { ...((item.body ?? {}) as Record<string, unknown>), scheduledDate: slot.date };
        await tx.query('UPDATE items SET body = $1::jsonb, publish_at = $2 WHERE id = $3', [
          JSON.stringify(bodyObj),
          publishAt.toISOString(),
          item.id,
        ]);
      } else if (videoRow) {
        publishAt = null;
      } else {
        publishAt = await nextSlot(tx, item.worldId, now);
        await tx.query('UPDATE items SET publish_at = $1 WHERE id = $2', [publishAt.toISOString(), item.id]);
      }
      const moved = await transitionTx(tx, item.id, 'scheduled', agent.name, 'content push review: approved', { by: agent.name });
      const report = { ...((moved.qualityReport ?? {}) as Record<string, unknown>) };
      report.push = {
        ...((report.push ?? {}) as Record<string, unknown>),
        review: {
          decision: 'approve',
          by: agent.name,
          at: now.toISOString(),
          ...(decision.sourcesChecked ? { sourcesChecked: decision.sourcesChecked } : {}),
          ...(decision.solvedAnswer ? { solvedAnswer: decision.solvedAnswer } : {}),
        },
      };
      await tx.query('UPDATE items SET quality_report = $1::jsonb WHERE id = $2', [JSON.stringify(report), item.id]);
      await audit(tx, agent.name, 'content_push.review_approve', item.id, {
        publishAt: publishAt ? publishAt.toISOString() : null,
        ...(videoRow ? { videoGated: true } : {}),
      });
      return { ...moved, qualityReport: report, publishAt };
    });
  } catch (err) {
    if (err instanceof IllegalTransitionError)
      return fail(409, 'invalid_state', { message: 'The item changed state while it was being reviewed; read it again.' });
    throw err;
  }
  const video = await videoRowFor(db, item.id);
  return {
    status: 200,
    json: { ...itemView(stored), world: await worldSlug(db, item.worldId), ...(video ? { video: videoView(video) } : {}) },
  };
}

// --- Publish -------------------------------------------------------------------------------------------

export async function publishPushItem(db: Db, agent: Agent, id: string, deps: PushDeps = {}): Promise<ApiResult> {
  if (agent.role !== 'promoter') return fail(403, 'forbidden_role', { message: 'Only a promoter key can publish a pushed item.' });
  const item = await loadPushItem(db, agent, id);
  if (!item) return fail(404, 'not_found');
  if (item.status !== 'scheduled')
    return fail(409, 'invalid_state', { message: `Only an approved item can be published; this one is ${workflowStatus(item.status)}.` });

  const video = await videoRowFor(db, item.id);
  if (video && video.state !== 'public') {
    let row = video;
    if (row.state === 'pending_upload' || row.state === 'failed' || row.state === 'auth_expired')
      row = await processVideo(db, item, { ...deps, actor: agent.name });
    if (row.state === 'auth_expired') return fail(409, 'youtube_auth_expired', { message: YOUTUBE_AUTH_EXPIRED });
    if (row.state === 'private') {
      // The flip to public is part of publishing, and it happens BEFORE the item goes public, so a
      // failed flip never leaves a public page pointing at a private video.
      try {
        await setVideoPrivacy(videoDeps(deps), row.youtube_id!, 'public');
      } catch (err) {
        if (err instanceof SocialPostError && err.kind === 'credentials') {
          await setVideoState(db, item.id, { state: 'auth_expired', error: YOUTUBE_AUTH_EXPIRED });
          await audit(db, agent.name, 'content_push.video_auth_expired', item.id, {});
          return fail(409, 'youtube_auth_expired', { message: YOUTUBE_AUTH_EXPIRED });
        }
        return fail(502, 'video_privacy_failed', { message: 'YouTube refused the privacy change; the item was not published' });
      }
      row = await setVideoState(db, item.id, { state: 'public', privacy_status: 'public' as YoutubePrivacy, error: null });
      await audit(db, agent.name, 'content_push.video_privacy', item.id, { to: 'public', youtubeId: row.youtube_id });
    }
    // Anything still not public (a failed upload, another processor's 'uploading' claim) blocks the
    // publish: the item never goes public ahead of its video.
    if (row.state !== 'public')
      return fail(409, 'video_upload_failed', { message: row.error ?? `the video is ${row.state}, not public` });
  }

  let stored: StoredItem;
  try {
    stored = await db.transaction(async (tx) => {
      const moved = await transitionTx(tx, item.id, 'published', agent.name, 'content push: published by promoter');
      await audit(tx, agent.name, 'content_push.publish', item.id, { slug: item.slug });
      return moved;
    });
  } catch (err) {
    if (err instanceof IllegalTransitionError)
      return fail(409, 'invalid_state', { message: 'The item changed state while it was being published; read it again.' });
    throw err;
  }
  const after = await videoRowFor(db, item.id);
  return {
    status: 200,
    json: { ...itemView(stored), world: await worldSlug(db, item.worldId), ...(after ? { video: videoView(after) } : {}) },
  };
}
