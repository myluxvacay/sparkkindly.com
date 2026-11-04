import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Account',
  robots: { index: false, follow: false },
  // strict-origin, not no-referrer: no-referrer makes browsers send "Origin: null" on form posts, which the origin check
  // rightly refuses. Origin only (never the path), so a sign-in or consent token in a page's URL cannot reach a log
  // through a Referer header, not even for same-site links.
  referrer: 'strict-origin',
};

// Display only (noindex, spacing). Every account page also calls requireAccounts() itself, because a layout check
// alone does not guard a page.
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <div className="container trust-page admin">{children}</div>;
}
