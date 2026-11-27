import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Family Hub',
  robots: { index: false, follow: false },
  referrer: 'strict-origin',
};

// Display only (noindex, spacing). Every /family page also calls requireHubAdult() itself.
export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return <div className="container trust-page admin">{children}</div>;
}
