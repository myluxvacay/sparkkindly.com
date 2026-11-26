import { notFound } from 'next/navigation';
import Link from 'next/link';
import ItemCard from '@/components/item/ItemCard';
import BandLead from '@/components/BandLead';
import Breadcrumb from '@/components/Breadcrumb';
import Pager from '@/components/Pager';
import { getDb } from '@/lib/db';
import { currentScope } from '@/lib/accounts/scope-next';
import { getTopic, listWorlds, type World } from '@/lib/public/worlds';
import { listPublic, topicCounts } from '@/lib/public/reads';
import { topicDescription } from '@/lib/public/topics';
import { PAGE_SIZE, pageCanonical, parsePage } from '@/lib/public/paging';
import {
  clusterBySlug, topicBySlug, topicsInCluster, type ClusterDef, type TopicDef,
} from '@/lib/topics-hub/data';
import {
  HUB_GROUPS, clusterFeatured, groupItems, hubWorlds, matchTopicItems, topicCount,
} from '@/lib/topics-hub/match';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string; section?: string }> };

// A hub page's meta description is the start of its own intro, trimmed to a search snippet.
const hubDescription = (intro: string): string => {
  if (intro.length <= 160) return intro;
  const cut = intro.slice(0, 157);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
};

export async function generateMetadata({ params, searchParams }: Props) {
  const slug = (await params).slug;
  const cluster = clusterBySlug(slug);
  if (cluster) return seo(cluster.name, hubDescription(cluster.intro), `/topics/${cluster.slug}/`);
  const topic = topicBySlug(slug);
  // A topic page is one page however it is filtered, so its canonical is always the page itself.
  if (topic) return seo(topic.title, hubDescription(topic.intro), `/topics/${topic.slug}/`);
  const page = parsePage((await searchParams).page);
  const t = (await topicCounts(getDb(), await currentScope())).find((x) => x.slug === slug);
  return t ? seo(`Topic: ${t.name}`, topicDescription(t.name, t.count), pageCanonical(`/topics/${t.slug}/`, page)) : {};
}

export default async function TopicSlugPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const cluster = clusterBySlug(slug);
  if (cluster) return <ClusterHub cluster={cluster} />;
  const topic = topicBySlug(slug);
  if (topic) return <TopicHub topic={topic} section={sp.section} page={parsePage(sp.page)} />;
  return <CuratedTopic slug={slug} page={parsePage(sp.page)} />;
}

// --- The cluster hub: a cluster's intro, its topic pages with live counts, a few featured items.
async function ClusterHub({ cluster }: { cluster: ClusterDef }) {
  const scope = await currentScope();
  const topics = topicsInCluster(cluster.slug).map((t) => ({ def: t, count: topicCount(t, scope) }));
  const featured = clusterFeatured(cluster.slug, scope, 6);
  const seeAlso = (cluster.seeAlso ?? []).map((s) => topicBySlug(s)).filter((t): t is TopicDef => Boolean(t));

  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Topics', href: '/topics/' }, { name: cluster.name }]} />
      <p className="eyebrow">TOPIC CLUSTER</p>
      <h1>{cluster.name}</h1>
      <p className="intro-text">{cluster.intro}</p>
      <div className="hub-topic-cards">
        {topics.map(({ def, count }) => (
          <article key={def.slug} className="hub-topic-card">
            <h2><Link href={`/topics/${def.slug}/`}>{def.title}</Link></h2>
            <p className="hub-count-line">{count} {count === 1 ? 'item' : 'items'}</p>
            <p>{def.intro}</p>
          </article>
        ))}
      </div>
      {featured.length > 0 && (
        <section className="section">
          <p className="eyebrow">FEATURED</p>
          <h2>Start here in {cluster.name}</h2>
          <BandLead className="card-list">
            {featured.map((i) => (
              <ItemCard item={i} world={hubWorlds.get(i.world)} key={i.id} headingLevel={3} variant="text" />
            ))}
          </BandLead>
        </section>
      )}
      {seeAlso.length > 0 && (
        <p className="hub-note">
          Also explore:{' '}
          {seeAlso.map((t, idx) => (
            <span key={t.slug}>
              {idx > 0 && ' · '}
              <Link href={`/topics/${t.slug}/`}>{t.title}</Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

// --- The topic landing page: the topic's intro, then its matched items grouped by type
// (reads, printables, games, quizzes). The overview previews each group; a group with more
// than a page of items gets its own paginated view at ?section=<group>.
async function TopicHub({ topic, section, page }: { topic: TopicDef; section?: string; page: number }) {
  const scope = await currentScope();
  const cluster = clusterBySlug(topic.cluster);
  const groups = groupItems(matchTopicItems(topic, scope));
  const total = HUB_GROUPS.reduce((n, g) => n + groups[g.key].length, 0);
  const here = `/topics/${topic.slug}/`;
  const active = HUB_GROUPS.find((g) => g.key === section);

  const header = (
    <>
      <Breadcrumb
        trail={[
          { name: 'Home', href: '/' },
          { name: 'Topics', href: '/topics/' },
          ...(cluster ? [{ name: cluster.name, href: `/topics/${cluster.slug}/` }] : []),
          { name: topic.title },
        ]}
      />
      <p className="eyebrow">{(cluster?.name ?? 'TOPIC').toUpperCase()}</p>
      <h1>{topic.title}</h1>
      <p className="intro-text">{topic.intro}</p>
      <p className="hub-count-line">
        {total} {total === 1 ? 'item' : 'items'}:{' '}
        {HUB_GROUPS.filter((g) => groups[g.key].length > 0)
          .map((g) => `${groups[g.key].length} ${g.label.toLowerCase()}`)
          .join(' · ')}
      </p>
    </>
  );

  if (active) {
    const all = groups[active.key];
    const items = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (page > 1 && !items.length) notFound(); // SEO audit M3, as on the other listings
    const base = `${here}?section=${active.key}`;
    return (
      <div className="container section">
        {header}
        <p><Link className="underlined" href={here}>← Everything on this topic</Link></p>
        <section>
          <h2>{active.label} ({all.length})</h2>
          <BandLead className="card-list">
            {items.map((i) => (
              <ItemCard item={i} world={hubWorlds.get(i.world)} key={i.id} headingLevel={3} variant="text" />
            ))}
          </BandLead>
          <Pager
            prev={page > 1 ? (page === 2 ? base : `${base}&page=${page - 1}`) : undefined}
            next={all.length > page * PAGE_SIZE ? `${base}&page=${page + 1}` : undefined}
            prevLabel="← Newer"
            nextLabel="Older →"
          />
        </section>
      </div>
    );
  }

  const siblings = topicsInCluster(topic.cluster).filter((t) => t.slug !== topic.slug);
  return (
    <div className="container section">
      {header}
      {HUB_GROUPS.map((g) => {
        const all = groups[g.key];
        if (!all.length) return null;
        return (
          <section key={g.key} className="hub-group">
            <h2>{g.label} ({all.length})</h2>
            <BandLead className="card-list">
              {all.slice(0, PAGE_SIZE).map((i) => (
                <ItemCard item={i} world={hubWorlds.get(i.world)} key={i.id} headingLevel={3} variant="text" />
              ))}
            </BandLead>
            {all.length > PAGE_SIZE && (
              <p><Link className="underlined" href={`${here}?section=${g.key}`}>See all {all.length} {g.label.toLowerCase()} →</Link></p>
            )}
          </section>
        );
      })}
      {!total && <p>Nothing here yet. <Link href="/topics/">Browse the other topics</Link>.</p>}
      {cluster && siblings.length > 0 && (
        <section className="hub-group">
          <h2>More in {cluster.name}</h2>
          <ul className="hub-topic-list">
            {siblings.map((t) => (
              <li key={t.slug}>
                <Link href={`/topics/${t.slug}/`}>{t.title}</Link>
                <span className="hub-count"> ({topicCount(t, scope)})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// --- The curated topic page, unchanged: a database topic with its items, newest first.
async function CuratedTopic({ slug, page }: { slug: string; page: number }) {
  const db = getDb();
  const topic = await getTopic(db, slug);
  if (!topic) notFound();
  const [rows, worlds] = await Promise.all([
    listPublic(db, await currentScope(), { topic: topic.slug, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    listWorlds(db),
  ]);
  const byWorld = new Map<string, World>(worlds.map((w) => [w.slug, w]));
  const items = rows.slice(0, PAGE_SIZE);
  if (page > 1 && !items.length) notFound(); // SEO audit M3
  const here = `/topics/${topic.slug}/`;

  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: topic.name }]} />
      <p className="eyebrow">TOPIC</p>
      <h1>{topic.name}</h1>
      <div className="card-list">
        {items.map((i) => <ItemCard item={i} world={byWorld.get(i.world)} key={i.id} headingLevel={2} variant="text" />)}
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
