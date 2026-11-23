import Link from 'next/link';
import ItemCard from '@/components/item/ItemCard';
import Pager from '@/components/Pager';
import { getDb } from '@/lib/db';
import { PAGE_SIZE, parsePage } from '@/lib/public/paging';
import { searchPublic } from '@/lib/public/reads';
import { currentScope } from '@/lib/accounts/scope-next';
import { listWorlds } from '@/lib/public/worlds';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search', robots: { index: false, follow: false } };

const MAX_Q = 100;

type Props = { searchParams: Promise<{ q?: string | string[]; page?: string; f?: string | string[] }> };

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const raw = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? '';
  const trimmed = raw.trim();
  const q = trimmed.slice(0, MAX_Q);
  const page = parsePage(sp.page);
  // The Printables filter (22 Nov 2026): f=printables narrows the search to the printables topic, so a
  // family looking for a sheet to print is not wading through articles and quizzes.
  const printablesOnly = (Array.isArray(sp.f) ? sp.f[0] : sp.f) === 'printables';
  const db = getDb();
  const rows = q
    ? await searchPublic(db, await currentScope(), q, { limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }, printablesOnly ? { topic: 'printables' } : {})
    : [];
  const items = rows.slice(0, PAGE_SIZE);
  const worlds = new Map((await listWorlds(db)).map((w) => [w.slug, w]));
  const href = (p: number) =>
    `/search/?q=${encodeURIComponent(q)}${printablesOnly ? '&f=printables' : ''}${p > 1 ? `&page=${p}` : ''}`;

  return (
    <div className="container section">
      <p className="eyebrow">LOOK AROUND</p>
      <h1>Search</h1>
      <form method="get" action="/search/" role="search">
        <label htmlFor="q">Search SparkKindly</label>{' '}
        <input id="q" type="search" name="q" defaultValue={q} maxLength={MAX_Q} autoComplete="off" />{' '}
        <button className="button" type="submit">Search</button>
      </form>
      {q && (
        <div className="watch-chips" role="group" aria-label="Filter search results">
          <Link className={printablesOnly ? 'watch-chip' : 'watch-chip active'} href={`/search/?q=${encodeURIComponent(q)}`}>
            All results
          </Link>
          <Link className={printablesOnly ? 'watch-chip active' : 'watch-chip'} href={`/search/?q=${encodeURIComponent(q)}&f=printables`}>
            Printables only
          </Link>
        </div>
      )}
      {trimmed.length > MAX_Q && <p>We used the first {MAX_Q} characters of your search.</p>}
      {!q && <p>Type a word or two to look through titles and summaries.</p>}
      {q && !items.length && (
        <p>
          {page > 1 ? (
            <>Nothing on this page. <Link href={href(1)}>Back to the first page</Link>.</>
          ) : (
            <>
              Nothing matched. Try a simpler word — or, if it&apos;s a printable you&apos;re after,{' '}
              <Link href={`/printables/request/?text=${encodeURIComponent(q)}`}>request it</Link> and we&apos;ll add it
              to the list.
            </>
          )}
        </p>
      )}
      <div className="card-list">
        {items.map((i) => <ItemCard item={i} world={worlds.get(i.world)} key={i.id} headingLevel={2} variant="text" />)}
      </div>
      <Pager
        prev={page > 1 ? href(page - 1) : undefined}
        next={rows.length > PAGE_SIZE ? href(page + 1) : undefined}
        prevLabel="← Previous"
        nextLabel="More →"
      />
    </div>
  );
}
