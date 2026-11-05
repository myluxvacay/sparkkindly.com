import { notFound } from 'next/navigation';
import ContributionQueue from '@/components/admin/ContributionQueue';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { contributorsEnabled } from '@/lib/config';
import { ownerContributionQueue, pendingLinks } from '@/lib/contributors/owner';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

// The owner's contribution queue (plan 8): contributions the reviewer passed, and proposed contributor links.
export default async function AdminContributionsPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (!contributorsEnabled()) notFound();
  const { done, error } = await searchParams;
  const db = getDb();
  const [queue, links] = await Promise.all([ownerContributionQueue(db), pendingLinks(db)]);
  return (
    <>
      <h1>Contributions</h1>
      <StatusNote done={done} error={error} />
      <ContributionQueue queue={queue} links={links} csrf={admin.csrf} />
    </>
  );
}
