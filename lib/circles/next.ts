// Next glue for circle pages: with ACCOUNTS_ENABLED or CIRCLES_ENABLED off every page is a 404; otherwise the page
// needs the signed-in adult context (no session goes to sign-in, a child context to the "Playing as" page).
import { notFound } from 'next/navigation';
import { requireAdult } from '@/lib/accounts/next';
import type { AdultContext } from '@/lib/accounts/context';
import { circlesEnabled } from '@/lib/config';

export async function requireCirclesAdult(): Promise<AdultContext> {
  if (!circlesEnabled()) {
    notFound();
  }
  return requireAdult();
}
