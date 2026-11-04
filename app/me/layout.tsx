import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your SparkKindly',
  robots: { index: false, follow: false },
  // As on the account pages: Origin only, so form posts keep their Origin and no path reaches a Referer.
  referrer: 'strict-origin',
};

// Display only (noindex, spacing). Every /me page also calls requireContext() itself.
export default function MeLayout({ children }: { children: React.ReactNode }) {
  return <div className="container trust-page admin">{children}</div>;
}
