import Link from 'next/link';

// An item's own topics as links to their topic pages (SEO audit H1). Nothing when the item has none.
export default function TopicLinks({ topics }: { topics: { slug: string; name: string }[] }) {
  if (!topics.length) return null;
  return (
    <nav aria-label="Topics" className="topic-links">
      <ul>
        {topics.map((t) => (
          <li key={t.slug}>
            <Link className="pill" href={`/topics/${t.slug}/`}>
              {t.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
