import Link from 'next/link';
import { notFound } from 'next/navigation';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { socialEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { videoJobs } from '@/lib/social/video/admin';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

// Plan 5B: the video jobs queue: each selected video script's job with its state and post status. Exists only with
// SOCIAL_ENABLED on.
export default async function AdminVideosPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  void admin; // the list has no forms; the guard is what matters
  if (!socialEnabled()) notFound();
  const { done, error } = await searchParams;
  const jobs = await videoJobs(getDb(), new Date());
  return (
    <>
      <h1>Video jobs</h1>
      <StatusNote done={done} error={error} />
      <p className="muted">
        The promotion run writes a brief for each video; whoever makes the video uploads it to its job, you approve it, and
        the worker posts it.
      </p>
      {jobs.length === 0 ? (
        <p>No video jobs yet.</p>
      ) : (
        <ul className="admin-list">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link href={`/admin/social/videos/${j.id}/`}>{j.title}</Link> · {j.platform} · job <strong>{j.state.replace('_', ' ')}</strong> · post{' '}
              {j.distributionStatus.replace('_', ' ')}
              {j.postUrl && (
                <>
                  {' '}
                  · <a href={j.postUrl}>view post</a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
