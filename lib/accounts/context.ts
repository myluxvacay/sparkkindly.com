// The server-derived active context (plan 3C): the signed-in account, its active child profile (stored on the session
// row, never taken from a request) and the audiences that context may see. A child context sees `kids` and `all` only,
// never `adults` (.claude/rules/data-isolation.md). The only id a caller ever passes is the profile to switch to, and it
// must belong to the session's own account (checked here; the composite foreign key on account_sessions backs it).
// No Next.js imports. Verified by tests/unit/account-context.test.ts.
import type { Db } from '@/lib/db';
import type { Audience } from '@/lib/public/scope';
import { hash } from '@/lib/tokens';
import { checkPin, isUuid } from './pin';
import { sessionView, type AccountView, type ActiveProfile } from './sessions';

export type AccountContext = { account: AccountView; profile: ActiveProfile | null; audiences: readonly Audience[] };
export type AdultContext = AccountContext & { profile: null };

const CHILD: readonly Audience[] = ['kids', 'all'];
// `adults` means "aimed at adults", not an age gate (spec, Project 1): an account sees what an anonymous visitor sees.
const MEMBER: readonly Audience[] = ['kids', 'all', 'adults'];

export async function getContext(db: Db, sessionToken: string, now: Date): Promise<AccountContext | null> {
  const s = await sessionView(db, sessionToken, now);
  if (!s) {
    return null;
  }
  return { ...s, audiences: s.profile ? CHILD : MEMBER };
}

// The gate for settings, invites, comments, contribute and PIN change: null (deny) for a child context or no context.
export function requireAdultContext(ctx: AccountContext | null): AdultContext | null {
  return ctx && ctx.profile === null ? (ctx as AdultContext) : null;
}

// Only from the adult context (a child cannot hop to a sibling without the PIN), only to this account's own profile.
export async function switchToProfile(db: Db, sessionToken: string, profileId: string, now: Date): Promise<boolean> {
  if (!isUuid(profileId)) {
    return false;
  }
  const ctx = requireAdultContext(await getContext(db, sessionToken, now));
  if (!ctx) {
    return false;
  }
  const r = await db.query(
    `UPDATE account_sessions SET active_profile_id = $2
     WHERE token_hash = $1 AND account_id = $3 AND active_profile_id IS NULL
       AND EXISTS (SELECT 1 FROM child_profiles WHERE id = $2 AND account_id = $3)`,
    [hash(sessionToken), profileId, ctx.account.id],
  );
  return r.rowCount === 1;
}

// Back to the adult context with the account's PIN (5 wrong entries lock it, see pin.ts). Already adult: nothing to do,
// and 'ok' then means only "the context is adult", NOT "the PIN was checked" (no PIN is read). Never use this as a PIN
// verification step; changePin and checkPin in pin.ts are the only PIN checks.
export async function switchToAdult(db: Db, sessionToken: string, pin: unknown, now: Date): Promise<'ok' | 'wrong' | 'locked'> {
  const ctx = await getContext(db, sessionToken, now);
  if (!ctx) {
    return 'wrong';
  }
  if (!ctx.profile) {
    return 'ok';
  }
  const checked = await checkPin(db, ctx.account.id, pin, now);
  if (checked === 'ok') {
    await db.query('UPDATE account_sessions SET active_profile_id = NULL WHERE token_hash = $1 AND account_id = $2', [
      hash(sessionToken),
      ctx.account.id,
    ]);
  }
  return checked;
}
