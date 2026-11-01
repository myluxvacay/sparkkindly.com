import { notFound } from 'next/navigation';
import Link from 'next/link';
import ItemCard from '@/components/item/ItemCard';
import Breadcrumb from '@/components/Breadcrumb';
import Pager from '@/components/Pager';
import { getDb } from '@/lib/db';
import { anonymousScope } from '@/lib/public/scope';
import { getTopic, listWorlds } from '@/lib/public/worlds';
import { listPublic } from '@/lib/public/reads';
import { PAGE_SIZE, parsePage } from '@/lib/public/paging';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: Props) {
  const t = await getTopic(getDb(), (await params).slug);
  return t ? seo(`Topic: ${t.name}`, `Everything on SparkKindly about ${t.name}.`, `/topics/${t.slug}/`) : {};
}

export default async function TopicPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const page = parsePage((await searchParams).page);
  const db = getDb();
  const topic = await getTopic(db, slug);
  if (!topic) notFound();
  const [rows, worlds] = await Promise.all([
    listPublic(db, anonymousScope(), { topic: topic.slug, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    listWorlds(db),
  ]);
  const byWorld = new Map(worlds.map((w) => [w.slug, w]));
  const items = rows.slice(0, PAGE_SIZE);
  const here = `/topics/${topic.slug}/`;

  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: topic.name }]} />
      <p className="eyebrow">TOPIC</p>
      <h1>{topic.name}</h1>
      <div className="content-grid two-col">
        {items.map((i) => <ItemCard item={i} world={byWorld.get(i.world)} key={i.id} headingLevel={2} />)}
      </div>
      {!items.length && <p>Nothing here yet. <Link href="/">Back to the beginning</Link>.</p>}
      <Pager
        prev={page > 1 ? (page === 2 ? here : `${here}?page=${page - 1}`) : undefined}
        next={rows.length > PAGE_SIZE ? `${here}?page=${page + 1}` : undefined}
        prevLabel="← Newer"
        nextLabel="Older →"
      />
    </div>
  );
}
