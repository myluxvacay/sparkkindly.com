import { z } from 'zod';
import type { ArticleView, ImageView } from '@/lib/public/body';
import { formatDay } from '@/lib/public/dates';

const source = z.object({ title: z.string(), url: z.string().startsWith('https://'), accessedAt: z.string().optional() });

// Stored sources are untrusted text: only well-formed https links are rendered, each with a safe rel.
export default function Sources({ sources, article, image }: { sources: unknown[]; article: ArticleView; image: ImageView }) {
  const list = sources.flatMap((s) => {
    const r = source.safeParse(s);
    return r.success ? [r.data] : [];
  });
  return (
    <section className="source-notes container">
      <h2>Sources, credits &amp; transparency</h2>
      {list.length ? (
        <ul>
          {list.map((s) => (
            <li key={s.url}>
              <a href={s.url} rel="noopener noreferrer">
                {s.title}
              </a>
              {s.accessedAt && formatDay(s.accessedAt) && <> · accessed {formatDay(s.accessedAt)}</>}
            </li>
          ))}
        </ul>
      ) : (
        <p>Original creative or practical content; no external factual claims are used as evidence.</p>
      )}
      {image.credit && (
        <p>
          {image.credit}. {image.rights}.
        </p>
      )}
      {article.aiDisclosure && <p>{article.aiDisclosure}</p>}
      {article.correctionNote && <p>Correction: {article.correctionNote}</p>}
    </section>
  );
}
