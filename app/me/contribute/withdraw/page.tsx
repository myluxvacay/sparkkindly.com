import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdult } from '@/lib/accounts/next';
import { contributorsEnabled } from '@/lib/config';
import { getMine } from '@/lib/contributors/drafts';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ id?: string }> };

// The confirm step before a withdrawal (plan 8). Only the contributor's own piece; anything else is 404.
export default async function WithdrawPage({ searchParams }: Props) {
  if (!contributorsEnabled()) notFound();
  const ctx = await requireAdult();
  const { id } = await searchParams;
  const mine = await getMine(getDb(), ctx.account.id, id);
  if (!mine || mine.state === 'withdrawn') notFound();
  return (
    <>
      <h1>Withdraw this piece?</h1>
      <p>
        <strong>{mine.content.title || '(untitled)'}</strong>
      </p>
      <p>
        {mine.itemPath
          ? 'It is published now and will be taken down at once. This cannot be undone.'
          : 'It will not be reviewed or published. This cannot be undone.'}
      </p>
      <form method="post" action="/me/contribute/withdraw/confirm/" className="admin-form">
        <input type="hidden" name="id" value={mine.id} />
        <button type="submit" className="button">
          Withdraw it
        </button>
      </form>
      <p>
        <Link href="/me/contribute/">Keep it and go back</Link>
      </p>
    </>
  );
}
