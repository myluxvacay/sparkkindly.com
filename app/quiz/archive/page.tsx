import Link from 'next/link';
import ItemCard from '@/components/item/ItemCard';
import Pager from '@/components/Pager';
import { getDb } from '@/lib/db';
import { PAGE_SIZE, parsePage } from '@/lib/public/paging';
import { listQuizzes } from '@/lib/public/reads';
import { anonymousScope } from '@/lib/public/scope';
import { listWorlds } from '@/lib/public/worlds';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export const metadata = seo('Quiz archive', 'Every published SparkKindly quiz, newest first, each with an accessible answer and explanation.', '/quiz/archive/');

export default async function Archive({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = parsePage((await searchParams).page);
  const db = getDb();
  const rows = await listQuizzes(db, anonymousScope(), { limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
  const items = rows.slice(0, PAGE_SIZE);
  const worlds = new Map((await listWorlds(db)).map((w) => [w.slug, w]));
  const here = '/quiz/archive/';
  return (
    <div className="container section">
      <p className="eyebrow">A SHELF OF LITTLE CHALLENGES</p>
      <h1>The quiz archive</h1>
      <p className="intro-text">Explore our collection, newest first. There’s no clock to beat.</p>
      <div className="content-grid two-col">
        {items.map((q) => <ItemCard item={q} world={worlds.get(q.world)} key={q.id} headingLevel={2} />)}
      </div>
      {!items.length && <p>Our first questions are still being checked. Please visit again soon. <Link href="/quiz/">Back to today’s quiz</Link></p>}
      <Pager
        prev={page > 1 ? (page === 2 ? here : `${here}?page=${page - 1}`) : undefined}
        next={rows.length > PAGE_SIZE ? `${here}?page=${page + 1}` : undefined}
        prevLabel="← Newer"
        nextLabel="Older →"
      />
    </div>
  );
}
