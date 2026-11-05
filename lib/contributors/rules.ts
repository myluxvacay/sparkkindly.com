// Contributor rules (plan 8, spec Project 8): limits, the contributor's draft shape, profile field checks and the mapping
// from a contribution to the agent item format (lib/items/format.ts), so a contributed item passes the very same gates.
// Pure functions, no I/O, no Next.js imports. Verified by tests/unit/contributors-rules.test.ts.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createLimiter } from '@/lib/agents/rate-limit';
import { cleanText } from '@/lib/circles/rules';
import { cleanDisplayName, normaliseBody } from '@/lib/comments/rules';
import type { ItemSubmission } from '@/lib/items/format';

export const CONTRIBUTOR_LIMITS = {
  name: 30,
  bio: 140,
  link: 200,
  title: 140,
  summary: 300,
  body: 8000, // all section text together
  heading: 80,
  minSections: 2,
  maxSections: 6,
  takeaway: 300,
  question: 300,
  options: 4, // the existing multiple_choice format takes exactly four (plan 8 ruling)
  option: 120,
  explanation: 500,
  sources: 6,
  sourceTitle: 140,
  topics: 8,
  pending: 3,
  drafts: 5,
  savesPerHour: 10,
  submitsPerDay: 5,
  notes: 500,
} as const;

export const PENDING_STATES = ['submitted', 'agent_review', 'needs_owner', 'changes_requested'] as const;
export const EDITABLE_STATES = ['draft', 'changes_requested'] as const;

// Plain text: NFKC, \n kept, other control/format/default-ignorable characters dropped, trimmed (the comment rule).
const plain = (max: number, min = 0) =>
  z.preprocess((v) => normaliseBody(v ?? '') ?? '', z.string().min(min).max(max));
// One line: the same, with every run of whitespace (line breaks included) folded to one space.
const line = (max: number, min = 0) =>
  z.preprocess((v) => (normaliseBody(v ?? '') ?? '').replace(/\s+/g, ' '), z.string().min(min).max(max));

const ownSite = (u: string) => URL.canParse(u) && /(^|\.)sparkkindly\.com\.?$/i.test(new URL(u).hostname);
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => URL.canParse(u) && u.startsWith('https://') && !ownSite(u), 'a source needs an https:// address off this site');

const source = z.object({ title: line(CONTRIBUTOR_LIMITS.sourceTitle, 1), url: httpsUrl });
const section = z.object({ heading: line(CONTRIBUTOR_LIMITS.heading), text: plain(CONTRIBUTOR_LIMITS.body) });

// What a contributor saves. Only the fields below survive (zod drops the rest, so a forged status, audience, approval,
// agent or creator field never gets further). Lengths are capped here; completeness is the submit gates' job.
export const draftSchema = z
  .object({
    kind: z.enum(['article', 'quiz']),
    world: z.string().regex(/^[a-z0-9-]{2,30}$/),
    title: line(CONTRIBUTOR_LIMITS.title),
    summary: line(CONTRIBUTOR_LIMITS.summary),
    topics: z.array(z.string().regex(/^[a-z0-9-]{1,80}$/)).max(CONTRIBUTOR_LIMITS.topics).default([]),
    sources: z.array(source).max(CONTRIBUTOR_LIMITS.sources).default([]),
    sections: z.array(section).max(CONTRIBUTOR_LIMITS.maxSections).default([]),
    takeaway: line(CONTRIBUTOR_LIMITS.takeaway).default(''),
    question: line(CONTRIBUTOR_LIMITS.question).default(''),
    options: z.array(line(CONTRIBUTOR_LIMITS.option)).max(CONTRIBUTOR_LIMITS.options).default([]),
    correct: z.coerce.number().int().min(0).max(CONTRIBUTOR_LIMITS.options - 1).default(0),
    explanation: plain(CONTRIBUTOR_LIMITS.explanation).default(''),
  })
  .refine((d) => d.world !== 'kids', { message: 'Kids items are written by the SparkKindly team only', path: ['world'] })
  .refine((d) => d.sections.reduce((n, s) => n + s.text.length, 0) <= CONTRIBUTOR_LIMITS.body, {
    message: `an article has at most ${CONTRIBUTOR_LIMITS.body} characters of text`,
    path: ['sections'],
  });

export type DraftContent = z.infer<typeof draftSchema>;

export function parseDraft(input: unknown): { ok: true; value: DraftContent } | { ok: false; errors: string[] } {
  const r = draftSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, errors: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'form'}: ${i.message}`) };
}

// ---- Profile fields --------------------------------------------------------------------------------------------

export const cleanContributorName = (v: unknown): string | null => cleanDisplayName(v);

// Optional: empty means none; otherwise the comment-name checks (no link-like text, no blocked word), 1 to 140.
export function cleanBio(v: unknown): string | null | false {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  return cleanText(v, CONTRIBUTOR_LIMITS.bio) ?? false;
}

// Optional: empty means none; otherwise one https address off this site, at most 200 characters.
export function cleanLink(v: unknown): string | null | false {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v !== 'string') return false;
  const u = v.trim();
  return u.length <= CONTRIBUTOR_LIMITS.link && httpsUrl.safeParse(u).success ? u : false;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const randomId = (n: number) => [...randomBytes(n)].map((b) => ALPHABET[b % ALPHABET.length]).join('');

// The contributor page id: random, never derived from the name or the account.
export const newProfileSlug = (): string => randomId(10);

// An item slug from the first title, with a random suffix so two contributors' titles never collide.
export function newItemSlug(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${base || 'contribution'}-${randomId(6)}`;
}

// ---- Mapping to the item format ----------------------------------------------------------------------------------

export type ContributionRef = { id: string; kind: 'article' | 'quiz'; slug: string; world: string; revision: number; content: DraftContent };

const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
const OPTION_IDS = ['a', 'b', 'c', 'd'];

// The submission the gates check and the item row is built from. Audience is always `all` (never chosen by the
// contributor, never kids); nothing else the contributor sent beyond the draft fields exists here. Not validated:
// runGates' schema gate does that and names what is missing.
export function toSubmission(c: ContributionRef, now: Date): ItemSubmission {
  const d = c.content;
  const common = {
    world: c.world,
    slug: c.slug,
    title: d.title,
    summary: d.summary,
    audience: 'all' as const,
    evergreen: false,
    topics: d.topics,
    sources: d.sources.map((s) => ({ title: s.title, url: s.url, accessedAt: now.toISOString().slice(0, 10) })),
    idempotencyKey: `contribution-${c.id}-${c.revision}`,
  };
  if (c.kind === 'article') {
    return {
      ...common,
      kind: 'article',
      body: { sections: d.sections.map((s) => ({ heading: s.heading, paragraphs: paragraphs(s.text) })), takeaway: d.takeaway },
    };
  }
  const options = d.options.map((text, i) => ({ id: OPTION_IDS[i] ?? String(i), text }));
  return {
    ...common,
    kind: 'quiz',
    body: { mechanic: 'multiple_choice', prompt: d.question, options, difficulty: 'medium' },
    answer: { value: OPTION_IDS[d.correct], explanation: d.explanation },
  };
}

// ---- Rate limits -------------------------------------------------------------------------------------------------

// In memory, one process, like the account limits (createLimiter counts per minute; a slowed clock turns it into per
// hour or per day). ponytail: per instance; move to the database if the app ever runs as more than one instance.
export function createContributorLimits(clock: () => number = Date.now) {
  const saves = createLimiter({ perMinute: CONTRIBUTOR_LIMITS.savesPerHour, now: () => clock() / 60 });
  const submits = createLimiter({ perMinute: CONTRIBUTOR_LIMITS.submitsPerDay, now: () => clock() / 1440 });
  return { save: (accountId: string) => saves(accountId), submit: (accountId: string) => submits(accountId) };
}
export type ContributorLimits = ReturnType<typeof createContributorLimits>;

const shared = globalThis as unknown as { __sparkContributorLimits?: ContributorLimits };
export const contributorLimits = (shared.__sparkContributorLimits ??= createContributorLimits());
