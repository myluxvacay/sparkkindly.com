import { notFound } from 'next/navigation';
import Link from 'next/link';
import ItemCard from '@/components/item/ItemCard';
import Breadcrumb from '@/components/Breadcrumb';
import Pager from '@/components/Pager';
import MoneyDisclaimer, { showsMoneyDisclaimer } from '@/components/item/MoneyDisclaimer';
import { getDb } from '@/lib/db';
import { accountSessionToken, currentScope } from '@/lib/accounts/scope-next';
import SponsorCard from '@/components/sponsorship/SponsorCard';
import { loadWorldSponsor } from '@/lib/sponsorship/web';
import { getWorld } from '@/lib/public/worlds';
import { listPublic } from '@/lib/public/reads';
import { PAGE_SIZE, pageCanonical, parsePage } from '@/lib/public/paging';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ world: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params, searchParams }: Props) {
  const { world } = await params;
  const w = await getWorld(getDb(), world);
  const page = parsePage((await searchParams).page);
  return w ? seo(w.name, w.description ?? w.promise ?? '', pageCanonical(`/${w.slug}/`, page)) : {};
}

export default async function WorldPage({ params, searchParams }: Props) {
  const { world } = await params;
  const page = parsePage((await searchParams).page);
  const db = getDb();
  const w = await getWorld(db, world);
  if (!w) notFound();
  // One extra row tells us whether a next page exists without a count query.
  const rows = await listPublic(db, await currentScope(), { world: w.slug, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
  const items = rows.slice(0, PAGE_SIZE);
  if (page > 1 && !items.length) notFound(); // SEO audit M3: no empty, indexable page past the end
  const hasNext = rows.length > PAGE_SIZE;
  const feature = page === 1 ? items[0] : undefined;
  const rest = feature ? items.slice(1) : items;
  const here = `/${w.slug}/`;
  // The world's own sponsorship (Save, Grow and Discover only; null elsewhere, with the flag off and for viewers who may not see it).
  const sponsor = page === 1 ? await loadWorldSponsor(db, await accountSessionToken(), w.slug, new Date()) : null;

  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: w.name }]} />
      <header className={`brand-intro intro-${w.color ?? 'gold'}`}>
        <p className="eyebrow">THE WORLD OF {w.name.toUpperCase()}</p>
        <h1>{w.promise ?? w.name}</h1>
        <p>{w.description}</p>
        <span className="intro-symbol" aria-hidden="true">{w.icon}</span>
      </header>
      {showsMoneyDisclaimer(w.slug) && <MoneyDisclaimer />}
      {w.slug === 'kids' && (
        <aside className="grown-ups">
          <h2>For grown-ups</h2>
          <p>
            These activities are for ages 6–9 with an adult. Stay alongside, follow the safety guidance, and take the
            discoveries off-screen. No names, accounts, uploads, response storage, or tracking.
          </p>
          <Link href="/privacy/">Read our privacy explanation →</Link>
        </aside>
      )}
      {feature && (
        <section className="brand-feature feature-card">
          <img src={`/api/template-image/${feature.world}/${feature.slug}/`} width={800} height={420} alt="" />
          <div>
            <p className="eyebrow">FEATURED {feature.kind === 'article' ? 'READ' : feature.kind.toUpperCase()}</p>
            <h2><Link href={`/${feature.world}/${feature.slug}/`}>{feature.title}</Link></h2>
            <p>{feature.summary}</p>
            {/* The title link covers the whole card; this is its visual call to action, not a second link. */}
            <span className="button" aria-hidden="true">Take a closer look ↗</span>
          </div>
        </section>
      )}
      {sponsor && <SponsorCard line={sponsor} />}
      <section className="section">
        <p className="eyebrow">KEEP EXPLORING</p>
        <h2>More from {w.name}</h2>
        <div className="content-grid two-col">
          {rest.map((i) => <ItemCard item={i} world={w} key={i.id} />)}
        </div>
        {!items.length && page === 1 && <p>Our first pieces are being reviewed. Please come back for a little more wonder.</p>}
        <Pager
          prev={page > 1 ? (page === 2 ? here : `${here}?page=${page - 1}`) : undefined}
          next={hasNext ? `${here}?page=${page + 1}` : undefined}
          prevLabel="← Newer"
          nextLabel="Older →"
        />
      </section>
    </div>
  );
}
