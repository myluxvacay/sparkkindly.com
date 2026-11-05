// The four social admin actions (plan 5A), merged into lib/admin/actions.ts, which runs each inside one transaction with
// its audit_log row and makes them unknown while SOCIAL_ENABLED is off. `fail` builds that module's action error, so a
// refusal reaches the owner as a fixed message code. No Next.js imports. Verified by tests/unit/social-admin.test.ts.
import type { Queryable } from '@/lib/db';
import type { ErrorCode } from '@/lib/admin/messages';
import { cancelDistribution, distributionStatus, keepDistribution, parsePlatformForm, pickItem, retryDistribution, savePlatform } from './admin';
import { isPlatform } from './states';

type Ctx = { tx: Queryable; admin: { email: string }; form: URLSearchParams; now: Date };
type Done = { code: 'social_platform_saved' | 'social_picked' | 'social_retried' | 'social_cancelled' | 'social_kept'; target: string; detail?: Record<string, unknown> };
type Fail = (status: 400 | 404 | 409, code: ErrorCode) => Error;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PICK_ERRORS = { platform: 'social_platform', ineligible: 'social_ineligible', cap: 'social_cap', exists: 'social_exists' } as const;

function distributionId(f: URLSearchParams, fail: Fail): number {
  const id = (f.get('id') ?? '').trim();
  if (!/^\d{1,12}$/.test(id)) throw fail(400, 'bad_input');
  return Number(id);
}

async function requireStatus(tx: Queryable, id: number, fail: Fail): Promise<string> {
  const status = await distributionStatus(tx, id);
  if (!status) throw fail(404, 'not_found');
  return status;
}

export function socialHandlers(fail: Fail): Record<string, (c: Ctx) => Promise<Done>> {
  return {
    async 'social.platform_set'({ tx, form }) {
      const s = parsePlatformForm(form);
      if (!s) throw fail(400, 'bad_input');
      await savePlatform(tx, s);
      return { code: 'social_platform_saved', target: `social:${s.platform}`, detail: { enabled: s.enabled, dailyCap: s.dailyCap, postTime: s.postTime } };
    },

    async 'social.pick'({ tx, form, now }) {
      const item = (form.get('item') ?? '').trim();
      const platform = form.get('platform') ?? '';
      if (!UUID.test(item) || !isPlatform(platform)) throw fail(400, 'bad_input');
      const r = await pickItem(tx, item, platform, now);
      if (!r.ok) throw fail(409, PICK_ERRORS[r.reason]);
      return { code: 'social_picked', target: item, detail: { platform } };
    },

    async 'social.retry'({ tx, form, now }) {
      const id = distributionId(form, fail);
      await requireStatus(tx, id, fail);
      if (!(await retryDistribution(tx, id, now))) throw fail(409, 'wrong_status');
      return { code: 'social_retried', target: `distribution:${id}` };
    },

    // 5A review M1: a flagged row the owner found on the platform is kept as posted.
    async 'social.mark_posted'({ tx, form, now }) {
      const id = distributionId(form, fail);
      await requireStatus(tx, id, fail);
      if (!(await keepDistribution(tx, id, now))) throw fail(409, 'wrong_status');
      return { code: 'social_kept', target: `distribution:${id}` };
    },

    async 'social.cancel'({ tx, form }) {
      const id = distributionId(form, fail);
      // Never while the poster is mid-call (posting): the platform may be publishing it.
      if ((await requireStatus(tx, id, fail)) === 'posting' || !(await cancelDistribution(tx, id))) throw fail(409, 'wrong_status');
      return { code: 'social_cancelled', target: `distribution:${id}` };
    },
  };
}
