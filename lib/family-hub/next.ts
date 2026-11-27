import { notFound, redirect } from 'next/navigation';
import { familyHubEnabled } from '@/lib/config';
import { requireAdult } from '@/lib/accounts/next';
import type { AdultContext } from '@/lib/accounts/context';

// Next glue for Family Hub pages. The gate is the account system's adult context: no session
// goes to sign-in, a child ("playing as") context is sent to the PIN page by requireAdult, and
// with the Hub switched off the whole area is a 404. Circle membership is then checked per page
// in the data layer — a circle the account does not belong to is a 404, never a permission error
// that would confirm it exists.
export function requireHub(): void {
  if (!familyHubEnabled()) {
    notFound();
  }
}

export async function requireHubAdult(): Promise<AdultContext> {
  requireHub();
  return requireAdult();
}

export function circleOr404<T>(value: T | null): T {
  if (value === null) {
    notFound();
  }
  return value;
}

export { redirect };
