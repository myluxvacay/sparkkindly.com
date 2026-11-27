import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Family Hub',
  robots: { index: false, follow: false },
  referrer: 'strict-origin',
};

// Display only (noindex, spacing). Every /family page also gates itself: parent pages call
// requireHubAdult(); the kid view (/family/[circleId]/kid/[kidProfileId]/) is the one
// exception — it is gated by the kid-view PIN session instead (kid-session.ts).
export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return <div className="container trust-page admin">{children}</div>;
}
