import { notFound } from 'next/navigation';
import SocialAdmin from '@/components/admin/SocialAdmin';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { socialEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { socialOverview } from '@/lib/social/admin';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

// Plan 5A: platform switches, caps and times; the day's picks and skips with reasons; posts, errors and flagged rows;
// hand-pick, retry and cancel; visits from social links. Exists only with SOCIAL_ENABLED on.
export default async function AdminSocialPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (!socialEnabled()) notFound();
  const { done, error } = await searchParams;
  const overview = await socialOverview(getDb(), new Date(), process.env);
  return (
    <>
      <h1>Social</h1>
      <StatusNote done={done} error={error} />
      <SocialAdmin csrf={admin.csrf} overview={overview} />
    </>
  );
}
