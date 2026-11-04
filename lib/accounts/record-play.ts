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

export function recordableRequest(headers: Headers): boolean {
  if (headers.get('sec-fetch-site') !== 'same-origin') {
    return false;
  }
  return !['sec-purpose', 'purpose', 'x-moz'].some((h) => headers.get(h)?.toLowerCase().includes('prefetch'));
}

export async function recordPlay(db: Db, owner: Owner | null, result: PlayResult, now: Date): Promise<void> {
  if (!owner || result.status !== 'ok') {
    return;
  }
  try {
    await recordAnswer(db, owner, result.itemId, result.correct, now);
  } catch (err) {
    console.error('answer recording failed:', (err as Error)?.name);
  }
}
