import Link from 'next/link';
import { notFound } from 'next/navigation';
import Breadcrumb from '@/components/Breadcrumb';
import { currentScope } from '@/lib/accounts/scope-next';
import { contributorList } from '@/lib/contributors/byline';
import { contributorsEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export const metadata = seo('Contributors', 'The people who have shared published pieces on SparkKindly.', '/contributors/');

// Index of contributors with published pieces (plan 8). 404 with the flag off.
export default async function ContributorsIndex() {
  if (!contributorsEnabled()) notFound();
  const people = await contributorList(getDb(), await currentScope());
  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Contributors' }]} />
      <p className="eyebrow">CONTRIBUTORS</p>
      <h1>People who share with SparkKindly</h1>
      {people.length ? (
        <ul>
          {people.map((p) => (
            <li key={p.slug}>
              <Link href={`/contributors/${p.slug}/`}>{p.displayName}</Link> · {p.pieces} {p.pieces === 1 ? 'piece' : 'pieces'}
            </li>
          ))}
        </ul>
      ) : (
        <p>No contributed pieces are published yet.</p>
      )}
      <p>
        Want to share something? Read the <Link href="/contributors/terms/">contributor terms</Link>.
      </p>
    </div>
  );
}
