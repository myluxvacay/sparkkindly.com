'use client';
import { useMemo, useRef, useState } from 'react';
import { AGE_BANDS, PRINTABLE_CATEGORIES } from '@/lib/printables';

export type HubItem = {
  slug: string;
  title: string;
  summary: string;
  imageSrc: string | null;
  imageAlt: string;
  categoryTopic: string | null;
  categoryName: string | null;
  ageTopic: string | null;
  ageLabel: string | null;
};

// The /printables/ browser: a category shelf (the twelve collections from the plan) over a
// filterable grid. Filtering is client-side over the published printables, by category and by age
// band — the same chip pattern as the Watch catalogue.
export default function PrintablesHub({ items }: { items: HubItem[] }) {
  const [category, setCategory] = useState<string>('all');
  const [age, setAge] = useState<string>('all');
  const browseRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) if (item.categoryTopic) map.set(item.categoryTopic, (map.get(item.categoryTopic) ?? 0) + 1);
    return map;
  }, [items]);

  const shown = items.filter(
    (i) => (category === 'all' || i.categoryTopic === category) && (age === 'all' || i.ageTopic === age),
  );

  function pickCategory(topic: string) {
    setCategory(topic);
    browseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <>
      <h2 className="watch-heading">Browse by kind</h2>
      <ul className="printable-cats">
        {PRINTABLE_CATEGORIES.map((c) => (
          <li key={c.topic}>
            <button type="button" className="printable-cat-card" onClick={() => pickCategory(c.topic)}>
              <span className="printable-cat-glyph" aria-hidden="true">{c.glyph}</span>
              <span className="printable-cat-name">{c.name}</span>
              <span className="printable-cat-blurb">{c.blurb}</span>
              <span className="printable-cat-count">
                {counts.get(c.topic) ? `${counts.get(c.topic)} to print now` : 'Coming soon'}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div ref={browseRef} id="browse">
        <h2 className="watch-heading">All printables</h2>
        <div className="watch-chips" role="group" aria-label="Filter by kind">
          <button type="button" className={category === 'all' ? 'watch-chip active' : 'watch-chip'} aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
            All kinds
          </button>
          {PRINTABLE_CATEGORIES.map((c) => (
            <button
              key={c.topic}
              type="button"
              className={category === c.topic ? 'watch-chip active' : 'watch-chip'}
              aria-pressed={category === c.topic}
              onClick={() => setCategory(c.topic)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="watch-chips" role="group" aria-label="Filter by age">
          <button type="button" className={age === 'all' ? 'watch-chip active' : 'watch-chip'} aria-pressed={age === 'all'} onClick={() => setAge('all')}>
            All ages
          </button>
          {AGE_BANDS.map((a) => (
            <button
              key={a.topic}
              type="button"
              className={age === a.topic ? 'watch-chip active' : 'watch-chip'}
              aria-pressed={age === a.topic}
              onClick={() => setAge(a.topic)}
            >
              {a.label}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="muted">Nothing in this shelf yet — try another kind or age, or check back soon: new printables arrive in batches.</p>
        ) : (
          <ul className="printable-grid">
            {shown.map((item) => (
              <li key={item.slug} className="printable-card">
                <a href={`/printables/${item.slug}/`}>
                  {item.imageSrc ? (
                    <img src={item.imageSrc} alt="" width={400} height={300} loading="lazy" />
                  ) : (
                    <span className="card-tile gold" aria-hidden="true">✦</span>
                  )}
                  <span className="printable-card-body">
                    <span className="card-meta">
                      <span className="brand-label gold">Printable</span>
                      {item.ageLabel && <span>{item.ageLabel}</span>}
                    </span>
                    <span className="printable-card-title">{item.title}</span>
                    <span className="printable-card-summary">{item.summary}</span>
                    {item.categoryName && <span className="printable-card-cat">{item.categoryName}</span>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
