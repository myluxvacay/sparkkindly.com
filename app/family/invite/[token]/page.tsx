import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireHubAdult } from '@/lib/family-hub/next';
import { inviteCircleName } from '@/lib/family-hub/repo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

// The invite landing: the token in the path is the secret. It names the circle (nothing else)
// and offers the accept button to a signed-in adult.
export default async function InvitePage({ params }: Props) {
  await requireHubAdult();
  const { token } = await params;
  const name = await inviteCircleName(getDb(), token, new Date());
  if (!name) {
    return (
      <>
        <h1>Invite not available</h1>
        <p>That invite link has expired, was already used, or is not valid. Ask the circle organizer for a fresh link.</p>
        <p>
          <Link href="/family/">Family Hub home</Link>
        </p>
      </>
    );
  }
  return (
    <>
      <h1>Join {name}?</h1>
      <p>
        Joining shares this family&rsquo;s schedule and runs board with you, and yours with them. Children in the circle are
        profiles managed by their parents — you will see their first names and the events they are part of.
      </p>
      <form method="post" action={`/family/invite/${token}/accept/`}>
        <button type="submit">Join {name}</button>
      </form>
    </>
  );
}
