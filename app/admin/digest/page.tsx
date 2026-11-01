import { buildDigest, renderDigest } from '@/lib/admin/digest';
import { requireAdmin } from '@/lib/admin/next';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// The same digest the worker emails each morning, built for this moment.
export default async function AdminDigestPage() {
  const admin = await requireAdmin();
  const { subject, text } = renderDigest(await buildDigest(getDb(), new Date()));
  return (
    <>
      <h1>Daily digest</h1>
      <p className="muted">
        As emailed to the admin addresses (you are {admin.email}). The worker sends it once a day after the digest hour.
      </p>
      <h2>{subject}</h2>
      <pre className="admin-pre">{text}</pre>
    </>
  );
}
