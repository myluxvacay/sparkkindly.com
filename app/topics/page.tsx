import Link from 'next/link';
import Breadcrumb from '@/components/Breadcrumb';
import { getDb } from '@/lib/db';
import { currentScope } from '@/lib/accounts/scope-next';
import { topicCounts } from '@/lib/public/reads';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export const metadata = seo(
  'Topics',
  'Every SparkKindly topic, from science and nature to kindness and money habits, with the number of reads, quizzes and games in each.',
  '/topics/',
);

// The topic index (SEO audit H1): every curated topic with its count of items the viewer may see. A topic with
// nothing yet is listed without a link, so no link leads to an empty page.
export default async function TopicsPage() {
  const topics = await topicCounts(getDb(), await currentScope());
  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Topics' }]} />
      <p className="eyebrow">TOPICS</p>
      <h1>Follow a topic.</h1>
      <ul className="topic-index">
        {topics.map((t) => (
          <li key={t.slug}>
            {t.count > 0 ? <Link href={`/topics/${t.slug}/`}>{`${t.name} (${t.count})`}</Link> : `${t.name} (0)`}
          </li>
        ))}
      </ul>
    </div>
  );
}
