import Link from 'next/link';
import Breadcrumb from '@/components/Breadcrumb';
import TopicSearch, { type HubSearchTopic } from '@/components/topics/TopicSearch';
import { getDb } from '@/lib/db';
import { currentScope } from '@/lib/accounts/scope-next';
import { topicCounts } from '@/lib/public/reads';
import { TOPICS, clusterBySlug, topicSearchText } from '@/lib/topics-hub/data';
import { hubCounts } from '@/lib/topics-hub/match';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export const metadata = seo(
  'Topics',
  'Topic hubs for what families look for: counting, kindness, countries, how things work and more — reads, quizzes, games and printables gathered by topic.',
  '/topics/',
);

// The topic index is now the master hub (26 Nov 2026): the search-topic clusters and their
// landing pages with live counts, searchable in place. Below them, the curated topic index
// keeps its place (SEO audit H1): every curated topic that has items the viewer may see. A
// topic with nothing yet is omitted entirely (teen UI pass, 15 Nov 2026): a dead "(0)" entry
// reads as a broken promise. The curated read needs the database; like the sitemap's promo
// URLs, a read failure simply omits that section rather than breaking the page.
export default async function TopicsPage() {
  const scope = await currentScope();
  const { perTopic } = hubCounts(scope);
  const searchTopics: HubSearchTopic[] = TOPICS.map((t) => ({
    slug: t.slug,
    title: t.title,
    cluster: t.cluster,
    clusterName: clusterBySlug(t.cluster)?.name ?? t.cluster,
    count: perTopic.get(t.slug) ?? 0,
    searchText: topicSearchText(t, clusterBySlug(t.cluster)?.name ?? t.cluster),
  }));

  let curated: { slug: string; name: string; count: number }[] = [];
  try {
    curated = (await topicCounts(getDb(), scope)).filter((t) => t.count > 0);
  } catch {
    curated = [];
  }

  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Topics' }]} />
      <p className="eyebrow">TOPICS</p>
      <h1>Follow a topic.</h1>
      <p className="intro-text">
        Every hub below gathers the reads, quizzes, games and printables we have on one thing a
        family might look for — a skill, a subject, a question that starts with “how”. Search, or
        browse a cluster.
      </p>
      <TopicSearch topics={searchTopics} />
      {curated.length > 0 && (
        <section className="hub-cluster">
          <h2>More topics, A–Z</h2>
          <ul className="topic-index">
            {curated.map((t) => (
              <li key={t.slug}>
                <Link href={`/topics/${t.slug}/`}>{`${t.name} (${t.count})`}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="hub-note">
        Looking for a world instead? Start from <Link href="/kids/">Kids</Link>,{' '}
        <Link href="/discover/">Discover</Link> or <Link href="/play/">Play</Link> — or try the{' '}
        <Link href="/search/">site search</Link>.
      </p>
    </div>
  );
}
