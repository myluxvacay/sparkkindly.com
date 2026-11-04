// Rate limit for account sign-up: 5 per network per hour (IPv4 address, IPv6 /64). Sign-in link requests reuse
// createSignInLimits from lib/admin/guard.ts. In memory, one process, like the admin limits.
// Verified by tests/unit/account-limits.test.ts.
import { clientPrefix, createCodeLimits, createSignInLimits } from '@/lib/admin/guard';
import { createLimiter } from '@/lib/agents/rate-limit';

export function createSignUpLimits(clock: () => number = Date.now) {
  // createLimiter counts per minute; a clock running 60x slow turns "n per minute" into "n per hour".
  const perNetwork = createLimiter({ perMinute: 5, now: () => clock() / 60 });
  return { signUp: (ip: string): boolean => perNetwork(clientPrefix(ip)) };
}

const shared = globalThis as unknown as { __sparkSignUpLimits?: ReturnType<typeof createSignUpLimits> };
export const signUpLimits = (shared.__sparkSignUpLimits ??= createSignUpLimits());

// Link confirmations: 20 an hour per network, a separate bucket from admin's.
export const confirmLimits = createCodeLimits();

// Sign-in link requests: the admin limits' shape, but its own instance on its own key, so account traffic can never
// spend admin's per-address or per-network allowance (or the reverse).
const linkShared = globalThis as unknown as { __sparkAccountLinkLimits?: ReturnType<typeof createSignInLimits> };
export const accountLinkLimits = (linkShared.__sparkAccountLinkLimits ??= createSignInLimits());
