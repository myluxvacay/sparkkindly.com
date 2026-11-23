// The Request-a-Creation admin actions, merged into lib/admin/actions.ts, which runs each inside one
// transaction with its audit_log row. Three decisions, matching the queue's lifecycle: approve (the
// request joins the public Fresh Requests shelf), decline (it never appears anywhere public), and
// create (mark it made, with the published item's on-site path — the shelf then shows "Made!" and
// links it). Each names the statuses it may start from; a stale form or a second decision is a 409,
// never a silent overwrite. `fail` builds that module's action error. No Next.js imports.
// Verified by tests/unit/requests-repo.test.ts.
import type { Queryable } from '@/lib/db';
import type { ErrorCode } from '@/lib/admin/messages';
import { getRequest, setRequestStatus } from './repo';
import type { RequestStatus } from './types';

type Ctx = { tx: Queryable; admin: { email: string }; form: URLSearchParams; now: Date };
type Done = { code: 'approved' | 'rejected' | 'published'; target: string; detail?: Record<string, unknown> };
type Fail = (status: 400 | 404 | 409, code: ErrorCode) => Error;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (f: URLSearchParams, name: string) => (f.get(name) ?? '').trim();

function requestId(f: URLSearchParams, fail: Fail): string {
  const id = field(f, 'id');
  if (!UUID.test(id)) throw fail(404, 'not_found');
  return id;
}

// The created item's link: an on-site path only (never an external URL), short and markup-free.
function createdUrl(f: URLSearchParams, fail: Fail): string {
  const v = field(f, 'created_url');
  if (!v.startsWith('/') || v.length > 300 || /[<>\s]/.test(v)) throw fail(400, 'bad_input');
  return v;
}

export function requestHandlers(fail: Fail) {
  const move = (from: RequestStatus[], to: RequestStatus, code: Done['code'], withUrl = false) =>
    async ({ tx, form, now }: Ctx): Promise<Done> => {
      const id = requestId(form, fail);
      const url = withUrl ? createdUrl(form, fail) : null;
      const existing = await getRequest(tx, id);
      if (!existing) throw fail(404, 'not_found');
      const moved = await setRequestStatus(tx, id, from, to, url, now);
      if (!moved) throw fail(409, 'bad_input');
      return { code, target: `printable-request:${id}`, detail: { from: existing.status, to } };
    };
  return {
    // Pending → approved: joins the public shelf. An already-created request keeps its link.
    'request.approve': move(['pending'], 'approved', 'approved'),
    // Pending or approved → declined: leaves (or never joins) the shelf.
    'request.decline': move(['pending', 'approved'], 'declined', 'rejected'),
    // Approved (or a fast-tracked pending) → created, with the published item's path.
    'request.create': move(['pending', 'approved'], 'created', 'published', true),
  };
}
