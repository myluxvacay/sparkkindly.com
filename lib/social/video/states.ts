// The video job state machine (plan 5B). A job waits for the promoter's brief, then for the finished file; a valid
// upload may be replaced until the owner approves the exact checksum shown. Posting itself is tracked on the job's
// distributions row (lib/social/states.ts), which approval moves to `scheduled`. Every move is one conditional UPDATE,
// so two callers racing on a job never both win. No Next.js imports. Verified by tests/unit/social-video-select.test.ts.
import type { Queryable } from '@/lib/db';

export const VIDEO_STATES = ['brief_pending', 'brief_ready', 'uploaded', 'approved', 'cancelled'] as const;
export type VideoState = (typeof VIDEO_STATES)[number];

export const VIDEO_EVENTS = {
  brief: { from: ['brief_pending'], to: 'brief_ready' }, // the promoter's validated brief is stored
  upload: { from: ['brief_ready', 'uploaded'], to: 'uploaded' }, // a validated file (a replacement before approval)
  approve: { from: ['uploaded'], to: 'approved' }, // the owner's checksum-bound approval
  cancel: { from: ['brief_pending', 'brief_ready', 'uploaded', 'approved'], to: 'cancelled' },
} as const satisfies Record<string, { from: readonly VideoState[]; to: VideoState }>;
export type VideoEvent = keyof typeof VIDEO_EVENTS;

export function nextVideoState(state: VideoState, event: VideoEvent): VideoState | null {
  const e = Object.hasOwn(VIDEO_EVENTS, event) ? VIDEO_EVENTS[event] : undefined;
  return e && (e.from as readonly string[]).includes(state) ? e.to : null;
}

// Moves one job by an event, only from the event's states (and the given version), bumping the version. `set` keys come
// from the calling code only; values are parameters.
export async function moveVideoJob(
  db: Queryable,
  id: number,
  event: VideoEvent,
  o: { version?: number; set?: Record<string, unknown> } = {},
): Promise<boolean> {
  const e = VIDEO_EVENTS[event];
  const params: unknown[] = [id, e.to, [...e.from]];
  const sets = Object.entries(o.set ?? {}).map(([col, v]) => {
    if (!/^[a-z_0-9]+$/.test(col)) throw new Error('bad column');
    return `, ${col} = $${params.push(v)}`;
  });
  const versionCheck = o.version === undefined ? '' : ` AND version = $${params.push(o.version)}`;
  const r = await db.query(
    `UPDATE video_jobs SET state = $2, version = version + 1, updated_at = now()${sets.join('')}
     WHERE id = $1 AND state = ANY($3::text[])${versionCheck} RETURNING id`,
    params,
  );
  return r.rows.length === 1;
}
