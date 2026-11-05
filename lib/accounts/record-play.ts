// Saving a signed-in profile's answer from the play panel (plan 3D, Task 3). The panel answers on a GET, so a record is
// written only for a same-origin request (our own form) that is not a prefetch: a cross-site link, a link scanner or a
// prefetch could otherwise plant a profile's FIRST answer, which is the one that counts. Everyone still sees the
// verdict. The owner comes from viewerForSession (scope.ts), never the request; the item id from the scoped playResult.
// A recording failure is logged by error name only and never changes what the visitor sees. No Next.js imports.
// Verified by tests/unit/play-record.test.ts.
import type { Db } from '@/lib/db';
import type { PlayResult } from '@/lib/play/answer';
import type { Owner } from './interests';
import { recordAnswer } from './responses';

// Request headers that mark a prefetch or prerender (browser, Firefox and the Next.js router).
const PREFETCH_HEADERS = ['sec-purpose', 'purpose', 'x-moz'];

export function recordableRequest(headers: Headers): boolean {
  if (headers.get('sec-fetch-site') !== 'same-origin' || headers.has('next-router-prefetch')) {
    return false;
  }
  return !PREFETCH_HEADERS.some((h) => headers.get(h)?.toLowerCase().includes('prefetch'));
}

// Which note the panel shows: `anonymous` (cannot save: the existing "does not save" note), `before` (can save, nothing
// answered yet), `saved` (this answer, or the first one before it, is saved) or `unsaved` (can save, but this request was
// not recordable, the item was not found or recording failed). Only `saved` may claim the answer is saved.
export type AnswerNote = 'anonymous' | 'before' | 'saved' | 'unsaved';

export async function recordPlay(
  db: Db,
  owner: Owner | null,
  result: PlayResult | null,
  recordable: boolean,
  now: Date,
): Promise<AnswerNote> {
  if (!owner) {
    return 'anonymous';
  }
  if (!result || result.status === 'invalid') {
    return 'before';
  }
  if (result.status !== 'ok' || !recordable) {
    return 'unsaved';
  }
  try {
    // false is a repeat (the first answer is already saved); a profile or account deleted mid-request also reads
    // as false. ponytail: not told apart, the session check just passed so that race is negligible.
    await recordAnswer(db, owner, result.itemId, result.correct, now, result.choice);
    return 'saved';
  } catch (err) {
    console.error('answer recording failed:', (err as Error)?.name);
    return 'unsaved';
  }
}
