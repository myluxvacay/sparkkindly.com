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

// The topic index (SEO audit H1): every curated topic that has items the viewer may see, with its count. A topic
// with nothing yet is omitted entirely (teen UI pass, 15 Nov 2026): a dead "(0)" entry reads as a broken promise,
// and the topic joins the index on its own when its first item publishes.
export default async function TopicsPage() {
  const topics = (await topicCounts(getDb(), await currentScope())).filter((t) => t.count > 0);
  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Topics' }]} />
      <p className="eyebrow">TOPICS</p>
      <h1>Follow a topic.</h1>
      <ul className="topic-index">
        {topics.map((t) => (
          <li key={t.slug}>
            <Link href={`/topics/${t.slug}/`}>{`${t.name} (${t.count})`}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
