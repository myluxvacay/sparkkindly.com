// The scope a public read uses for this request (plan 3D, Task 2): the signed-in context's audiences, so a child profile
// gets ['kids', 'all'] and never an `adults` item (.claude/rules/data-isolation.md). No cookie, a malformed, invalid or
// expired session is a signed-out visitor: the anonymous scope. A cookie whose lookup throws (a database error) could be
// a child's, so it fails closed to the child audiences and logs the error name only. No Next.js imports.
// The same lookup also gives the owner answers are saved for (Task 3), so scope and owner can never disagree: the owner
// is set only when the context may save answers (a child profile, or an account `can` allow), else null.
// Verified by tests/unit/account-scope.test.ts, tests/unit/play-record.test.ts and the public-reads rows in
// tests/unit/account-isolation.test.ts.
import type { Db } from '@/lib/db';
import { anonymousScope, type Scope } from '@/lib/public/scope';
import { CHILD_AUDIENCES, getContext, type AccountContext } from './context';
import type { Owner } from './interests';
import { can, childCan } from './policy';

export type Viewer = { scope: Scope; owner: Owner | null };

function answerOwner(ctx: AccountContext): Owner | null {
  const allowed = ctx.profile
    ? childCan('save_answers')
    : can(ctx.account.ageGroup, ctx.account.consent, 'save_answers');
  return allowed ? { accountId: ctx.account.id, profileId: ctx.profile?.id ?? null } : null;
}

export async function viewerForSession(db: Db, sessionToken: string | undefined, now: Date): Promise<Viewer> {
  if (!sessionToken) {
    return { scope: anonymousScope(now), owner: null };
  }
  try {
    const ctx = await getContext(db, sessionToken, now);
    return ctx
      ? { scope: { audiences: ctx.audiences, now }, owner: answerOwner(ctx) }
      : { scope: anonymousScope(now), owner: null };
  } catch (err) {
    console.error('public scope lookup failed:', (err as Error)?.name);
    return { scope: { audiences: CHILD_AUDIENCES, now }, owner: null };
  }
}

export async function scopeForSession(db: Db, sessionToken: string | undefined, now: Date): Promise<Scope> {
  return (await viewerForSession(db, sessionToken, now)).scope;
}
