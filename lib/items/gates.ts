import { lookup } from 'node:dns/promises';
import type { Queryable } from '@/lib/db';
import { itemSubmissionSchema, type ItemSubmission } from './format';
import { findBlockedWord, findBlockedTopic } from './blocked';
import { fleschKincaidGrade } from './readability';
import type { RiskTier } from './repo';

export type GateResult = { gate: string; ok: boolean; reason?: string };
export type GateWorld = { id: number; slug: string };
type Deps = { fetch?: typeof fetch; now?: Date; sourceBudgetMs?: number };

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

// True for an address on the public internet. Everything private, loopback, link-local (including the cloud metadata
// address), CGNAT, multicast or reserved is refused, and an IPv4-mapped IPv6 address is judged as the IPv4 it wraps.
export function isPublicAddress(ip: string): boolean {
  const addr = ip.toLowerCase();
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]);
  if (addr.includes(':')) {
    if (addr === '::' || addr === '::1') return false;
    if (/^f[cd]/.test(addr) || /^fe[89ab]/.test(addr) || addr.startsWith('ff')) return false; // unique-local, link-local, multicast
    return true;
  }
  const p = addr.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && c === 0))) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

// Source URLs are untrusted input and we fetch them from the server, so refuse anything that is not a named public
// https site: no credentials in the URL, no IP literals, no single-label or internal names, no numeric top level.
export function isSafeSourceUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/\.+$/, ''); // "localhost." is localhost
  if (!host || host === 'localhost' || /\.(localhost|local|internal|lan)$/.test(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[')) return false; // IP literals
  const labels = host.split('.');
  return labels.length >= 2 && !/^\d+$/.test(labels[labels.length - 1]);
}

// ponytail: the address is checked before the fetch, but the fetch resolves the name again, so DNS rebinding between
// the two is not closed. Pin the checked address with a custom dispatcher before sources can come from contributors.
async function resolvesPublicly(host: string): Promise<boolean> {
  const addresses = await lookup(host.replace(/\.+$/, ''), { all: true });
  return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
}

async function reachable(url: string, doFetch: typeof fetch, deadline: number): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isSafeSourceUrl(current)) return `not an allowed source address: ${current}`;
    if (!(await resolvesPublicly(new URL(current).hostname))) return `source resolves to a private address: ${current}`;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return 'source checks ran out of time';
    const signal = () => AbortSignal.timeout(Math.max(1, Math.min(SOURCE_TIMEOUT_MS, deadline - Date.now())));
    let res = await doFetch(current, { method: 'HEAD', redirect: 'manual', signal: signal() });
    if (res.status >= 400) {
      res = await doFetch(current, { method: 'GET', redirect: 'manual', signal: signal() });
      await res.body?.cancel();
    }
    if (res.status >= 200 && res.status < 300) return null;
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return `redirect without a location: ${current}`;
      current = new URL(location, current).toString();
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
  const doFetch = deps.fetch ?? fetch;
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
          problem = await reachable(s.url, doFetch, deadline);
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
