import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Breadcrumb from '@/components/Breadcrumb';
import ItemCard from '@/components/item/ItemCard';
import { currentScope } from '@/lib/accounts/scope-next';
import { contributorPage } from '@/lib/contributors/byline';
import { getDb } from '@/lib/db';
import { listWorlds } from '@/lib/public/worlds';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

// A contributor's public page (plan 8): display name, bio, the owner-approved link (adults only) and their published
// items. 404 for an unknown id, a contributor with nothing published, or with the flag off (contributorPage returns null).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await contributorPage(getDb(), slug, await currentScope());
  return page ? seo(page.displayName, `Pieces by ${page.displayName} on SparkKindly.`, `/contributors/${slug}/`) : {};
}

export default async function ContributorPage({ params }: Props) {
  const { slug } = await params;
  const db = getDb();
  const page = await contributorPage(db, slug, await currentScope());
  if (!page) notFound();
  const worlds = new Map((await listWorlds(db)).map((w) => [w.slug, w]));
  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: page.displayName }]} />
      <p className="eyebrow">CONTRIBUTOR</p>
      <h1>{page.displayName}</h1>
      {page.bio && <p className="article-summary">{page.bio}</p>}
      {page.link && (
        <p>
          <a href={page.link} rel="nofollow noopener noreferrer ugc">
            {page.link}
          </a>
        </p>
      )}
      <h2>Published pieces</h2>
      <div className="content-grid two-col">
        {page.items.map((i) => (
          <ItemCard item={i} world={worlds.get(i.world)} key={i.id} />
        ))}
      </div>
    </div>
  );
}
