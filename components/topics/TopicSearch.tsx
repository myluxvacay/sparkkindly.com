'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';

export type HubSearchTopic = {
  slug: string;
  title: string;
  cluster: string;
  clusterName: string;
  count: number;
  searchText: string;
};

// The master hub's search (26 Nov 2026): a client-side filter over the server-rendered topic
// list — type a word ("volcano", "counting", "feelings") or pick a cluster, and the list narrows
// in place. The full list is rendered on the server first, so the page is complete without
// JavaScript and every topic link is a real link. No storage, no tracking: the filter state
// lives only in this component.
export default function TopicSearch({ topics }: { topics: HubSearchTopic[] }) {
  const [query, setQuery] = useState('');
  const [cluster, setCluster] = useState('all');

  const clusters = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of topics) if (!seen.has(t.cluster)) seen.set(t.cluster, t.clusterName);
    return [...seen.entries()].map(([slug, name]) => ({ slug, name }));
  }, [topics]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = topics.filter(
    (t) => (cluster === 'all' || t.cluster === cluster) && words.every((w) => t.searchText.includes(w)),
  );
  const byCluster = clusters
    .map((c) => ({ ...c, topics: visible.filter((t) => t.cluster === c.slug) }))
    .filter((c) => c.topics.length > 0);

  return (
    <div className="hub-search">
      <div className="hub-search-controls">
        <div className="hub-search-field">
          <label htmlFor="hub-search-input">Search topics</label>
          <input
            id="hub-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try volcano, counting, feelings, chess…"
            autoComplete="off"
          />
        </div>
        <div className="hub-search-field">
          <label htmlFor="hub-cluster-select">Cluster</label>
          <select id="hub-cluster-select" value={cluster} onChange={(e) => setCluster(e.target.value)}>
            <option value="all">All clusters</option>
            {clusters.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>
      {byCluster.length === 0 && (
        <p className="hub-search-empty">No topics match that yet. Try a shorter word, or browse the clusters below.</p>
      )}
      {byCluster.map((c) => (
        <section key={c.slug} className="hub-cluster">
          <h2><Link href={`/topics/${c.slug}/`}>{c.name}</Link></h2>
          <ul className="hub-topic-list">
            {c.topics.map((t) => (
              <li key={t.slug}>
                <Link href={`/topics/${t.slug}/`}>{t.title}</Link>
                <span className="hub-count"> ({t.count})</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
