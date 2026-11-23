// The public Request-a-Creation form's server side (owner direction, 23 November 2026), modelled on
// the contact form (lib/contact/submit.ts): the same honeypot, the same plain-text-only rule, the
// same rate-limit shape. The differences are the point of the feature: NO name and NO email fields
// exist at all — a request is a category, an age band and one short sentence about what to make.
// `website` is a honeypot hidden from people; a bot that fills it is 'dropped': the caller answers
// as if the request were stored and nothing is written.
// Verified by tests/unit/requests-submit.test.ts and tests/unit/requests-repo.test.ts.
import { createHmac } from 'node:crypto';
import type { Queryable } from '@/lib/db';
import { clientPrefix } from '@/lib/admin/guard';
import { createLimiter } from '@/lib/agents/rate-limit';
import { createRequest } from './repo';
import { isRequestAgeBand, isRequestCategory } from './types';

export const MAX_REQUEST_TEXT = 280;
const MIN_REQUEST_TEXT = 3;
// The form takes plain text only. Angle brackets are markup, and nothing here ever renders a
// visitor's HTML — the text is stored as-is and escaped by React on every page that shows it.
const MARKUP = /[<>]/;

export type RequestInput = { category: unknown; age: unknown; text: unknown; website: unknown };
export type RequestResult = { status: 'stored' } | { status: 'dropped' } | { status: 'invalid' };

// The only identity a submission or vote ever leaves: a keyed HMAC of the client network prefix —
// IPv4 truncated to /24, IPv6 to /64 (clientPrefix) — and, for votes, the browser family string.
// The /24 truncation plus the server-secret key (the admin secret key, reused as pepper) mean the
// stored value cannot be enumerated back to an address by anyone who merely reads the table: at
// most it ever names a neighbourhood-sized network, never a person or a child.
export function visitorHash(clientIp: string, salt = ''): string {
  const key = process.env.ADMIN_SECRET_KEY ?? 'sparkkindly-requests-unpeppered';
  return createHmac('sha256', key).update(`${clientPrefix(clientIp, 24)}|${salt}`).digest('hex');
}

export async function submitPrintableRequest(
  db: Queryable,
  input: RequestInput,
  submitterHash: string,
): Promise<RequestResult> {
  if (typeof input.website === 'string' ? input.website !== '' : input.website != null) return { status: 'dropped' };
  const { category, age, text } = input;
  if (typeof category !== 'string' || !isRequestCategory(category)) return { status: 'invalid' };
  if (typeof age !== 'string' || !isRequestAgeBand(age)) return { status: 'invalid' };
  if (typeof text !== 'string') return { status: 'invalid' };
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (cleaned.length < MIN_REQUEST_TEXT || cleaned.length > MAX_REQUEST_TEXT || MARKUP.test(cleaned)) {
    return { status: 'invalid' };
  }
  await createRequest(db, { categoryTopic: category, ageTopic: age, requestText: cleaned, submitterHash });
  return { status: 'stored' };
}

export type RateResult = { ok: true } | { ok: false; retryAfter: number };

// Submissions: 5 an hour per client and 200 an hour overall — the contact form's limits. Votes are
// cheaper to make, so the per-client allowance is higher, with the same overall ceiling. As in the
// contact module, createLimiter counts per minute and is given a clock that runs 60x slow.
export function createRequestLimits(clock: () => number = Date.now) {
  const slow = () => clock() / 60;
  const submitPerClient = createLimiter({ perMinute: 5, now: slow });
  const votePerClient = createLimiter({ perMinute: 30, now: slow });
  const overall = createLimiter({ perMinute: 200, now: slow });
  return {
    submit: (clientKey: string): RateResult => {
      if (!submitPerClient(clientKey)) return { ok: false, retryAfter: 3600 / 5 };
      if (!overall('all')) return { ok: false, retryAfter: Math.ceil(3600 / 200) };
      return { ok: true };
    },
    vote: (clientKey: string): RateResult => {
      if (!votePerClient(clientKey)) return { ok: false, retryAfter: 3600 / 30 };
      if (!overall('all')) return { ok: false, retryAfter: Math.ceil(3600 / 200) };
      return { ok: true };
    },
  };
}

// One instance per process (the limiters live in memory).
export const checkRequestRate = createRequestLimits();
