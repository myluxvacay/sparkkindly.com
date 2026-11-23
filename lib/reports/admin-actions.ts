// The Report-a-Mistake admin actions, merged into lib/admin/actions.ts and run beside the
// Request-a-Creation actions: the three decisions of the reports lifecycle (migration 047) —
// fixed, not-a-mistake, duplicate. Each starts from 'pending' only; a second decision on the same
// report is a 409, never a silent overwrite. The older 'report.close' action (in actions.ts) still
// works and now also lands on 'fixed', so the long-standing /admin/reports/ page is unaffected in
// shape. `fail` builds that module's action error. No Next.js imports.
// Verified by tests/unit/reports-repo.test.ts.
import type { Queryable } from '@/lib/db';
import type { ErrorCode } from '@/lib/admin/messages';
import { setReportStatus, type ReportStatus } from './repo';

type Ctx = { tx: Queryable; admin: { email: string }; form: URLSearchParams; now: Date };
type Done = { code: 'report_fixed' | 'report_not_a_mistake' | 'report_duplicate'; target: string; detail?: Record<string, unknown> };
type Fail = (status: 400 | 404 | 409, code: ErrorCode) => Error;

const field = (f: URLSearchParams, name: string) => (f.get(name) ?? '').trim();

function reportId(f: URLSearchParams, fail: Fail): string {
  const id = field(f, 'id');
  if (!/^\d{1,18}$/.test(id)) throw fail(404, 'not_found');
  return id;
}

export function reportHandlers(fail: Fail) {
  const decide = (to: ReportStatus, code: Done['code']) =>
    async ({ tx, form }: Ctx): Promise<Done> => {
      const id = reportId(form, fail);
      const moved = await setReportStatus(tx, id, 'pending', to);
      if (!moved) {
        // Either no such report (404) or it was already decided (409): one probe tells them apart.
        const { rows } = await tx.query<{ id: string }>('SELECT id::text FROM problem_reports WHERE id = $1', [id]);
        throw rows.length ? fail(409, 'bad_input') : fail(404, 'not_found');
      }
      return { code, target: `report:${id}`, detail: { to } };
    };
  return {
    'report.fixed': decide('fixed', 'report_fixed'),
    'report.not-a-mistake': decide('not-a-mistake', 'report_not_a_mistake'),
    'report.duplicate': decide('duplicate', 'report_duplicate'),
  };
}
