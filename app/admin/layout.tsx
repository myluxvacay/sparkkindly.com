import type { Metadata } from 'next';
import AdminNav from '@/components/admin/AdminNav';
import { currentAdmin } from '@/lib/admin/next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
  // same-origin, not no-referrer: no-referrer makes browsers send "Origin: null" on form posts, which the admin
  // origin check rightly refuses. Nothing leaks cross-site either way.
  referrer: 'same-origin',
};

// The navigation shows only to a signed-in admin. This is display only: every page checks requireAdmin() itself.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await currentAdmin();
  return (
    <div className="container trust-page admin">
      {admin && <AdminNav email={admin.email} csrf={admin.csrf} />}
      {children}
    </div>
  );
}
