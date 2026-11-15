// The public-leaderboard settings POST (Project 4.11, ADR 0004), in the style of settings-web.ts: Origin is checked
// and the account is taken only from the adult context by asAdult; any id in the form is never read. The
// public_leaderboard capability (16+) is required — the settings page does not render the form without it, and the
// POST refuses without it too. Redirects carry an outcome code only.
// Verified by tests/unit/account-leaderboard-web.test.ts.
import { seeOther } from '@/lib/admin/guard';
import type { Db } from '@/lib/db';
import { asAdult } from './children-web';
import { can } from './policy';
import { saveLeaderboardProfile } from './leaderboard';

type LeaderboardDeps = { db: Db; now: Date };

const result = (code: string) => seeOther(`/account/settings/?r=${code}#result`);

export const saveLeaderboardRequest = (request: Request, d: LeaderboardDeps) =>
  asAdult(request, d, async (ctx, form) => {
    if (!can(ctx.account.ageGroup, ctx.account.consent, 'public_leaderboard')) return result('lb-ineligible');
    const r = await saveLeaderboardProfile(d.db, ctx.account.id, {
      optIn: form.has('opt_in'),
      publicName: form.get('public_name') ?? undefined,
      avatarKey: form.get('avatar_key') ?? undefined,
    });
    return result(r === 'ok' ? 'lb-saved' : r === 'blocked' ? 'lb-blocked' : 'lb-invalid');
  });
