import type { Metadata } from 'next';
import Link from 'next/link';
import { listChildProfiles } from '@/lib/accounts/children';
import { requireAdult } from '@/lib/accounts/next';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Delete a child profile' };

type Props = { searchParams: Promise<{ profile?: string }> };

// The confirm step: opening it deletes nothing; the button POSTs. Only the signed-in adult's own profiles are found.
export default async function DeleteChildPage({ searchParams }: Props) {
  const { account } = await requireAdult();
  const { profile: id } = await searchParams;
  const profile = (await listChildProfiles(getDb(), account.id)).find((p) => p.id === id);
  if (!profile) {
    return (
      <>
        <h1>This profile is not available</h1>
        <p role="alert">It may already be deleted.</p>
        <p>
          <Link href="/account/children/">Back to child profiles</Link>
        </p>
      </>
    );
  }
  return (
    <>
      <h1>Delete {profile.displayName}&apos;s profile?</h1>
      <p>The profile and everything it held are deleted straight away. This cannot be undone.</p>
      <form method="post" action="/account/children/delete/confirm/" className="admin-actions">
        <input type="hidden" name="profile_id" value={profile.id} />
        <button type="submit" className="button">
          Delete the profile
        </button>
        <Link href="/account/children/">Keep it</Link>
      </form>
    </>
  );
}
