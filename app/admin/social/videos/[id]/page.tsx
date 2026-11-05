import Link from 'next/link';
import { notFound } from 'next/navigation';
import StatusNote from '@/components/admin/StatusNote';
import VideoJobView from '@/components/admin/VideoJob';
import { requireAdmin } from '@/lib/admin/next';
import { socialEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { videoJob } from '@/lib/social/video/admin';
import { maxVideoBytes } from '@/lib/social/video/upload';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }> };

// Plan 5B: one video job: brief, upload, validation, checksum-bound approval, post result. SOCIAL_ENABLED only.
export default async function AdminVideoJobPage({ params, searchParams }: Props) {
  const admin = await requireAdmin();
  if (!socialEnabled()) notFound();
  const { id } = await params;
  const job = /^\d{1,12}$/.test(id) ? await videoJob(getDb(), Number(id)) : null;
  if (!job) notFound();
  const { done, error } = await searchParams;
  return (
    <>
      <p>
        <Link href="/admin/social/videos/">All video jobs</Link>
      </p>
      <h1>Video job: {job.title}</h1>
      <StatusNote done={done} error={error} />
      <VideoJobView csrf={admin.csrf} job={job} maxVideoMb={maxVideoBytes(process.env) / 1024 / 1024} />
    </>
  );
}
