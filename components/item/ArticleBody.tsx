import type { ArticleView } from '@/lib/public/body';

// The article text. Every value is rendered as text by React, so markup in a stored title or paragraph shows literally.
export default function ArticleBody({ article }: { article: ArticleView }) {
  return (
    <article className="prose">
      {article.materials && (
        <aside className="activity-info">
          <h2>Before you begin</h2>
          <p>
            <strong>Materials:</strong> {article.materials.join(', ')}
          </p>
          {article.supervision && (
            <p>
              <strong>Supervision:</strong> {article.supervision}
            </p>
          )}
          {article.safetyNotes && (
            <ul>
              {article.safetyNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </aside>
      )}
      {article.sections.map((s, i) => (
        <section key={`${i}-${s.heading}`}>
          <h2>{s.heading}</h2>
          {s.paragraphs.map((p, j) => (
            <p key={j}>{p}</p>
          ))}
        </section>
      ))}
      {article.screenFreeExtension && (
        <aside className="takeaway">
          <h2>Keep exploring off-screen</h2>
          <p>{article.screenFreeExtension}</p>
        </aside>
      )}
      {article.takeaway && (
        <aside className="takeaway">
          <p className="eyebrow">A LITTLE SOMETHING TO TAKE WITH YOU</p>
          <p>{article.takeaway}</p>
        </aside>
      )}
    </article>
  );
}
