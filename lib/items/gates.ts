import type { Queryable } from '@/lib/db';
import { itemSubmissionSchema, type ItemSubmission } from './format';
import { findBlockedWord, findBlockedTopic } from './blocked';
import { fleschKincaidGrade } from './readability';
import { isSafeSourceUrl, isPublicAddress } from './net-safety';
import { httpsProbe, type Probe } from './probe';
import type { RiskTier } from './repo';

export { isSafeSourceUrl, isPublicAddress };

export type GateResult = { gate: string; ok: boolean; reason?: string };
export type GateWorld = { id: number; slug: string };
type Deps = { probe?: Probe; now?: Date; sourceBudgetMs?: number };

const MAX_KIDS_GRADE = 6;
const DUPLICATE_WINDOW_DAYS = 90;
const SIMILARITY_LIMIT = 0.8;
const MAX_REDIRECTS = 3;
const SOURCE_TIMEOUT_MS = 5000;
const MAX_SOURCES = 10;
const SOURCE_BUDGET_MS = 20_000; // one limit across the whole sources gate, so many slow sources cannot tie up a request

const isKids = (sub: ItemSubmission, world: GateWorld) => sub.audience === 'kids' || world.slug === 'kids';

// Which rule set an item falls under (spec 4a.4). The Excluded tier is decided by the blocked-topics gate, not here.
export function riskTierFor(sub: ItemSubmission, world: GateWorld): RiskTier {
  if (isKids(sub, world)) return 'kids';
  if (world.slug === 'discover' || sub.sources.length > 0) return 'sourced';
  if ((sub.kind === 'quiz' || sub.kind === 'game') && (sub.body.mechanic === 'number' || sub.body.mechanic === 'put_in_order')) {
    return 'computable';
  }
  return 'reflective';
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

// Every text field of the submission (title, summary, body, answer, image text, source titles, topics, slug...), so a
// field added to the format later is covered by default. Only the idempotency key and publish time are skipped.
function allText(sub: ItemSubmission): string {
  const copy: Record<string, unknown> = { ...sub };
  delete copy.idempotencyKey;
  delete copy.publishAt;
  return collectStrings(copy).join('\n');
}

// The prose a child would read, one sentence per piece.
function kidsProse(sub: ItemSubmission): string {
  const parts: string[] = [sub.summary];
  if (sub.kind === 'article') {
    sub.body.sections.forEach((s) => parts.push(...s.paragraphs));
    parts.push(sub.body.takeaway);
  } else if (sub.kind === 'quiz' || sub.kind === 'game') {
    parts.push(sub.body.prompt, sub.answer.explanation);
  } else {
    parts.push(sub.body.hook, ...sub.body.beats.map((b) => b.voiceover));
  }
  return parts.map((p) => (/[.!?]$/.test(p.trim()) ? p : `${p}.`)).join(' ');
}

const words = (title: string) => new Set(title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
function jaccard(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared);
}

// Follows redirects by hand, at most MAX_REDIRECTS, re-checking the address text of every hop. The probe vets the
// resolved IP inside the connection (see probe.ts), so a name that resolves privately fails here with its reason.
async function reachable(url: string, probe: Probe, deadline: number): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isSafeSourceUrl(current)) return `not an allowed source address: ${current}`;
    const signal = () => {
      const left = deadline - Date.now();
      return left <= 0 ? null : AbortSignal.timeout(Math.min(SOURCE_TIMEOUT_MS, left));
    };
    let s = signal();
    if (!s) return 'source checks ran out of time';
    let res = await probe(current, 'HEAD', s);
    if (res.status >= 400) {
      s = signal();
      if (!s) return 'source checks ran out of time';
      res = await probe(current, 'GET', s);
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

async function run(gate: string, fn: () => Promise<{ ok: boolean; reason?: string }>): Promise<GateResult> {
  try {
    return { gate, ...(await fn()) };
  } catch (err) {
    return { gate, ok: false, reason: `could not run: ${(err as Error).message}` };
  }
}

const pass = { ok: true } as const;

export async function runGates(
  db: Queryable,
  sub: ItemSubmission,
  world: GateWorld,
  deps: Deps = {},
): Promise<{ ok: boolean; results: GateResult[] }> {
  const probe = deps.probe ?? httpsProbe;
  const now = deps.now ?? new Date();
  const tier = riskTierFor(sub, world);
  const results: GateResult[] = [];

  results.push(
    await run('schema', async () => {
      const r = itemSubmissionSchema.safeParse(sub);
      return r.success ? pass : { ok: false, reason: r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
    }),
  );

  results.push(
    await run('duplicate', async () => {
      const same = await db.query('SELECT 1 FROM items WHERE world_id = $1 AND locale = $2 AND slug = $3', [world.id, 'en', sub.slug]);
      if (same.rows.length) return { ok: false, reason: `the slug "${sub.slug}" is already used in this world` };
      const since = new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * 86_400_000).toISOString();
      const recent = await db.query<{ title: string }>('SELECT title FROM items WHERE world_id = $1 AND created_at > $2::timestamptz', [world.id, since]);
      const near = recent.rows.find((r) => jaccard(r.title, sub.title) >= SIMILARITY_LIMIT);
      return near ? { ok: false, reason: `the title is too similar to "${near.title}" (published in the last ${DUPLICATE_WINDOW_DAYS} days)` } : pass;
    }),
  );

  results.push(
    await run('blocked-words', async () => {
      const hit = findBlockedWord(allText(sub));
      return hit ? { ok: false, reason: 'contains a blocked word' } : pass;
    }),
  );

  results.push(
    await run('blocked-topics', async () => {
      const hit = findBlockedTopic(allText(sub));
      return hit ? { ok: false, reason: `touches an excluded topic: ${hit}` } : pass;
    }),
  );

  results.push(
    await run('sources', async () => {
      if (tier === 'sourced' && sub.sources.length === 0) return { ok: false, reason: 'factual content needs at least one source' };
      if (sub.sources.length > MAX_SOURCES) return { ok: false, reason: `at most ${MAX_SOURCES} sources are allowed` };
      const deadline = Date.now() + (deps.sourceBudgetMs ?? SOURCE_BUDGET_MS);
      for (const s of sub.sources) {
        let problem: string | null;
        try {
          problem = await reachable(s.url, probe, deadline);
        } catch (err) {
          problem = `could not reach ${s.url}: ${(err as Error).message}`;
        }
        if (problem) return { ok: false, reason: problem };
      }
      return pass;
    }),
  );

  results.push(
    await run('kids-readability', async () => {
      if (!isKids(sub, world)) return pass;
      const grade = fleschKincaidGrade(kidsProse(sub));
      return grade > MAX_KIDS_GRADE
        ? { ok: false, reason: `reading grade ${grade.toFixed(1)} is above the Kids limit of ${MAX_KIDS_GRADE}` }
        : pass;
    }),
  );

  results.push(
    await run('explained-answer', async () => {
      if (sub.kind !== 'quiz' && sub.kind !== 'game') return pass;
      return sub.answer.explanation.trim() ? pass : { ok: false, reason: 'a quiz or game needs an explanation of the answer' };
    }),
  );

  return { ok: results.every((r) => r.ok), results };
}
