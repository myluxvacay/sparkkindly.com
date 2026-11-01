import type { Queryable } from '@/lib/db';
import { createLimiter } from '@/lib/agents/rate-limit';
import { getPublicItem } from '@/lib/public/reads';
import type { Scope } from '@/lib/public/scope';

const REASONS = ['wrong', 'unsafe', 'broken', 'other'];
const MAX_MESSAGE = 1000;

export type ReportInput = { world: string; slug: string; reason: unknown; message: unknown; website: unknown };
export type ReportResult = { status: 'stored' } | { status: 'invalid' } | { status: 'not_found' };

// Stores one reader report against a visible item. Nothing about the sender is kept: no account, address or
// client key. `website` is a honeypot field hidden from people; a bot that fills it is told "stored" and nothing is
// written. The message is stored as typed; whoever displays it must encode it.
export async function submitReport(db: Queryable, scope: Scope, input: ReportInput): Promise<ReportResult> {
  if (typeof input.website === 'string' ? input.website !== '' : input.website != null) return { status: 'stored' };
  const { reason } = input;
  const message = input.message == null ? '' : input.message;
  if (typeof reason !== 'string' || !REASONS.includes(reason)) return { status: 'invalid' };
  if (typeof message !== 'string' || message.trim().length > MAX_MESSAGE) return { status: 'invalid' };
  // The same visibility rules as a reader gets: a draft, a video script or an out-of-audience item is not found.
  const item = await getPublicItem(db, scope, input.world, input.slug);
  if (!item) return { status: 'not_found' };
  await db.query('INSERT INTO problem_reports (item_id, reason, message) VALUES ($1, $2, $3)', [item.id, reason, message.trim()]);
  return { status: 'stored' };
}

export type RateResult = { ok: true } | { ok: false; retryAfter: number };

// 5 reports an hour per client and 200 an hour overall. createLimiter counts per minute, so it is given a clock that
// runs 60x slow: "5 per minute" there is 5 per hour here. Retry-After is the time for one token to come back.
export function createReportLimits(clock: () => number = Date.now) {
  const slow = () => clock() / 60;
  const perClient = createLimiter({ perMinute: 5, now: slow });
  const overall = createLimiter({ perMinute: 200, now: slow });
  return (clientKey: string): RateResult => {
    if (!perClient(clientKey)) return { ok: false, retryAfter: 3600 / 5 };
    if (!overall('all')) return { ok: false, retryAfter: Math.ceil(3600 / 200) };
    return { ok: true };
  };
}

// One instance per process (the limiter lives in memory).
export const checkReportRate = createReportLimits();
