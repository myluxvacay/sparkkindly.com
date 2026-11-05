import type { Metadata } from 'next';
import Link from 'next/link';
import { Result, type Messages } from '@/components/circles/Result';
import { requireCirclesAdult } from '@/lib/circles/next';
import { listMyCircles } from '@/lib/circles/repo';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your circles' };

type Props = { searchParams: Promise<{ r?: string }> };

const MESSAGES: Messages = {
  left: { text: 'You have left the circle.', ok: true },
  gone: { text: 'That circle is not available. It may be closed, or you may no longer be a member.', ok: false },
};
const KIND = { friends: 'Friends', family: 'Family', community: 'Community' } as const;

export default async function CirclesPage({ searchParams }: Props) {
  const { account } = await requireCirclesAdult();
  const [{ r }, circles] = await Promise.all([searchParams, listMyCircles(getDb(), account.id)]);
  return (
    <>
      <h1>Your circles</h1>
      <Result code={r} messages={MESSAGES} />
      <p>A circle is a small private group: only its members see who is in it.</p>
      {circles.length === 0 ? (
        <p>You are not in any circle yet.</p>
      ) : (
        <ul className="admin-list">
          {circles.map((c) => (
            <li key={c.slug}>
              <p>
                <Link href={`/circles/${c.slug}/`}>{c.name}</Link>
              </p>
              <p className="muted">
                {KIND[c.kind]} circle, {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
                {c.role === 'owner' ? ', you are the owner' : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link href="/circles/new/" className="button">
          Create a circle
        </Link>
      </p>
      <p>
        <Link href="/account/">Back to your account</Link>
      </p>
    </>
  );
}
