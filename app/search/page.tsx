import Link from 'next/link';
import ItemCard from '@/components/item/ItemCard';
import { getDb } from '@/lib/db';
import { PAGE_SIZE, parsePage } from '@/lib/public/paging';
import { searchPublic } from '@/lib/public/reads';
import { anonymousScope } from '@/lib/public/scope';
import { listWorlds } from '@/lib/public/worlds';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search', robots: { index: false, follow: false } };

const MAX_Q = 100;

type Props = { searchParams: Promise<{ q?: string | string[]; page?: string }> };

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const raw = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? '';
  const trimmed = raw.trim();
  const q = trimmed.slice(0, MAX_Q);
  const page = parsePage(sp.page);
  const db = getDb();
  const rows = q ? await searchPublic(db, anonymousScope(), q, { limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }) : [];
  const items = rows.slice(0, PAGE_SIZE);
  const worlds = new Map((await listWorlds(db)).map((w) => [w.slug, w]));
  const href = (p: number) => `/search/?q=${encodeURIComponent(q)}${p > 1 ? `&page=${p}` : ''}`;

  return (
    <div className="container section">
      <p className="eyebrow">LOOK AROUND</p>
      <h1>Search</h1>
      <form method="get" action="/search/" role="search">
        <label htmlFor="q">Search SparkKindly</label>{' '}
        <input id="q" type="search" name="q" defaultValue={q} maxLength={MAX_Q} autoComplete="off" />{' '}
        <button className="button" type="submit">Search</button>
      </form>
      {trimmed.length > MAX_Q && <p>We used the first {MAX_Q} characters of your search.</p>}
      {!q && <p>Type a word or two to look through titles and summaries.</p>}
      {q && !items.length && <p>{page > 1 ? <>Nothing on this page. <Link href={href(1)}>Back to the first page</Link>.</> : 'Nothing matched. Try a simpler word.'}</p>}
      <div className="content-grid two-col">
        {items.map((i) => <ItemCard item={i} world={worlds.get(i.world)} key={i.id} />)}
      </div>
      <nav aria-label="Pages" className="pager">
        {page > 1 && <Link rel="prev" href={href(page - 1)}>← Previous</Link>}
        {rows.length > PAGE_SIZE && <Link rel="next" href={href(page + 1)}>More →</Link>}
      </nav>
    </div>
  );
}
