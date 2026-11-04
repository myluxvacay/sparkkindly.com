// The scope a public read uses for this request (plan 3D, Task 2): the signed-in context's audiences, so a child profile
// gets ['kids', 'all'] and never an `adults` item (.claude/rules/data-isolation.md). No cookie, a malformed, invalid or
// expired session is a signed-out visitor: the anonymous scope. A cookie whose lookup throws (a database error) could be
// a child's, so it fails closed to the child audiences and logs the error name only. No Next.js imports.
// Verified by tests/unit/account-scope.test.ts and the public-reads rows in tests/unit/account-isolation.test.ts.
import type { Db } from '@/lib/db';
import { anonymousScope, type Scope } from '@/lib/public/scope';
import { CHILD_AUDIENCES, getContext } from './context';

export async function scopeForSession(db: Db, sessionToken: string | undefined, now: Date): Promise<Scope> {
  if (!sessionToken) {
    return anonymousScope(now);
  }
  try {
    const ctx = await getContext(db, sessionToken, now);
    return ctx ? { audiences: ctx.audiences, now } : anonymousScope(now);
  } catch (err) {
    console.error('public scope lookup failed:', (err as Error)?.name);
    return { audiences: CHILD_AUDIENCES, now };
  }
}
