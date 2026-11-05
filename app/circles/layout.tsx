import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Circles',
  robots: { index: false, follow: false },
  // strict-origin, as for the account pages: form posts carry a real Origin, and no circle URL reaches a Referer.
  referrer: 'strict-origin',
};

// Display only. Every circle page also checks the flags and the context itself (lib/circles/next.ts).
export default function CirclesLayout({ children }: { children: React.ReactNode }) {
  return <div className="container trust-page admin">{children}</div>;
}
