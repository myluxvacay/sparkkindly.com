// Account rate limits, in memory, one process, like the admin limits. Every instance lives on its own globalThis key,
// separate from admin's, so account traffic never spends admin's allowance (or the reverse); admin numbers are unchanged.
// Per-network ceilings are generous because schools, libraries and carrier NAT put many people behind one address; the
// per-address controls (mint cap, the 60-second fresh-link rule in sessions.ts) and the site-wide send budget are the
// main guard. Verified by tests/unit/account-limits.test.ts and tests/unit/account-web.test.ts.
import { clientPrefix, createCodeLimits, createSignInLimits } from '@/lib/admin/guard';
import { createLimiter } from '@/lib/agents/rate-limit';

const HOUR = 60 * 60_000;

// Sign-ups: 30 per network (IPv4 address, IPv6 /64) per hour.
export function createSignUpLimits(clock: () => number = Date.now) {
  // createLimiter counts per minute; a clock running 60x slow turns "n per minute" into "n per hour".
  const perNetwork = createLimiter({ perMinute: 30, now: () => clock() / 60 });
  return { signUp: (ip: string): boolean => perNetwork(clientPrefix(ip)) };
}

// Sign-in link requests: 60 per network per hour; at most 6 links minted per address per hour.
export const createAccountLinkLimits = (clock: () => number = Date.now) => createSignInLimits(clock, 60);

// Link confirmations: 60 per IPv4 /24 or IPv6 /64 per hour.
export const createConfirmLimits = (clock: () => number = Date.now) => createCodeLimits(clock, 60);

// Parent consent confirm and withdraw: 60 per network per hour, its own counter so sign-in link traffic never spends it.
export const createConsentLimits = (clock: () => number = Date.now) => createCodeLimits(clock, 60);

// One-click unsubscribe POSTs: 60 per network per hour, its own counter (mail clients post these without a session).
export const createUnsubscribeLimits = (clock: () => number = Date.now) => createCodeLimits(clock, 60);

// Parent consent email resends: one per account per hour (the account page's button).
export function createConsentResendLimits(clock: () => number = Date.now) {
  const perAccount = createLimiter({ perMinute: 1, now: () => clock() / 60 });
  return (accountId: string): boolean => perAccount(accountId);
}

// Signed-in account POSTs (export, PIN reset, interests save): 30 per account per hour, one instance per route.
export function createAccountActionLimits(clock: () => number = Date.now) {
  const perAccount = createLimiter({ perMinute: 30, now: () => clock() / 60 });
  return (accountId: string): boolean => perAccount(accountId);
}

// Site-wide budget of account emails per clock hour. Past it a send is skipped (the caller's response is unchanged) and
// one warning line per hour gives the budget, never an address or IP.
// ponytail: a fixed per-process window; move to the database if the app ever runs as more than one instance.
export function createSendBudget(
  opts: { perHour?: number; clock?: () => number; warn?: (line: string) => void } = {},
) {
  const perHour = opts.perHour ?? 300;
  const clock = opts.clock ?? Date.now;
  const warn = opts.warn ?? ((line: string) => console.warn(line));
  let hour = -1;
  let used = 0;
  let warned = false;
  return (): boolean => {
    const h = Math.floor(clock() / HOUR);
    if (h !== hour) {
      [hour, used, warned] = [h, 0, false];
    }
    if (used < perHour) {
      used++;
      return true;
    }
    if (!warned) {
      warned = true;
      warn(`account email budget reached: ${perHour} sent this hour; further account emails skipped until the next hour`);
    }
    return false;
  };
}

const shared = globalThis as unknown as {
  __sparkSignUpLimits?: ReturnType<typeof createSignUpLimits>;
  __sparkAccountLinkLimits?: ReturnType<typeof createAccountLinkLimits>;
  __sparkAccountConfirmLimits?: ReturnType<typeof createConfirmLimits>;
  __sparkAccountSendBudget?: ReturnType<typeof createSendBudget>;
  __sparkConsentLimits?: ReturnType<typeof createConsentLimits>;
  __sparkConsentResendLimits?: ReturnType<typeof createConsentResendLimits>;
  __sparkUnsubscribeLimits?: ReturnType<typeof createUnsubscribeLimits>;
  __sparkExportLimits?: ReturnType<typeof createAccountActionLimits>;
  __sparkPinResetLimits?: ReturnType<typeof createAccountActionLimits>;
  __sparkInterestsLimits?: ReturnType<typeof createAccountActionLimits>;
};
export const signUpLimits = (shared.__sparkSignUpLimits ??= createSignUpLimits());
export const accountLinkLimits = (shared.__sparkAccountLinkLimits ??= createAccountLinkLimits());
export const confirmLimits = (shared.__sparkAccountConfirmLimits ??= createConfirmLimits());
export const consentLimits = (shared.__sparkConsentLimits ??= createConsentLimits());
export const accountSendBudget = (shared.__sparkAccountSendBudget ??= createSendBudget());
export const consentResendLimits = (shared.__sparkConsentResendLimits ??= createConsentResendLimits());
export const unsubscribeLimits = (shared.__sparkUnsubscribeLimits ??= createUnsubscribeLimits());
export const exportLimits = (shared.__sparkExportLimits ??= createAccountActionLimits());
export const pinResetLimits = (shared.__sparkPinResetLimits ??= createAccountActionLimits());
export const interestsLimits = (shared.__sparkInterestsLimits ??= createAccountActionLimits());
