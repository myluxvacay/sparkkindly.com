import { BAND_LABEL, type ReadDirection, type ReadNextModel } from '@/lib/read/read-next';

// "Keep reading" (owner request, 20 Nov 2026): the reading counterpart of KeepPlaying. At the end of
// an article, Spark offers the next similar article as a card, plus — for banded articles — the same
// three level choices the quiz flow has (easier / same level / harder) across the reading bands.
// Server-rendered as plain links (the first candidate of each shelf), so the flow works with no
// JavaScript; the reading island (ReadNextEnhancer) re-picks against the device's read list and adds
// the flick / double-tap gestures on the Spark band.
//
// Spark presents the choices waving (the assistant's own artwork): a silent attention loop only —
// Spark's voice is tap-to-play from the Spark button, never automatic (the site's pinned sound rule).
const KR_SPARK = {
  animated: '/brand/spark-waving.gif',
  still: '/brand/spark.webp',
  alt: 'Spark, the SparkKindly guide, waving hello',
  w: 313,
  h: 627,
} as const;

const DIRECTIONS: { key: ReadDirection; label: string; arrow: string; offNote: string }[] = [
  { key: 'easier', label: 'Read an easier one', arrow: '↓', offNote: 'This is the gentlest level' },
  { key: 'same', label: 'Read another at this level', arrow: '→', offNote: 'No more articles to try right now' },
  { key: 'harder', label: 'Read a harder one', arrow: '↑', offNote: 'This is the trickiest level' },
];

export default function KeepReading({ model }: { model: ReadNextModel }) {
  const primary = model.primary;
  if (!primary) return null;
  // Every article has a share image (its hero, or the generated template card the article page itself
  // falls back to), so the recommendation card always shows a picture.
  const primaryImg = primary.image?.src ?? `/api/template-image${primary.href}`;
  return (
    <section className="keep-reading" data-kr data-kr-model={JSON.stringify(model)} aria-label="Keep reading">
      {/* The Spark band is the flick zone, as in the keep-playing block: it carries touch-action:none
          (globals.css .kr-flick) so a flick starting on the band reaches the island's flick detector
          instead of scrolling. Unlike the quiz block, the band holds one interactive element — the
          Spark button, Spark's tap-to-play voice — and the island's gesture handling simply ignores
          touches that start on it, so flicks begin anywhere else on the band. */}
      <div className="kr-head kr-flick" data-kr-flick>
        <button type="button" className="kr-spark-btn" data-kr-voice aria-label="Hear Spark say hello">
          <img
            className="kp-spark"
            src={KR_SPARK.animated}
            data-kr-still={KR_SPARK.still}
            width={KR_SPARK.w}
            height={KR_SPARK.h}
            alt={KR_SPARK.alt}
            loading="lazy"
          />
        </button>
        <p className="kr-title">
          <strong>Keep reading?</strong> Spark picked your next article.
        </p>
      </div>
      <a className="kr-card" href={primary.href} data-kr-btn="next">
        <img className="kr-card-img" data-kr-card-img src={primaryImg} alt="" width={208} height={156} loading="lazy" />
        <span className="kr-card-body">
          <span className="kr-card-title" data-kr-card-title>
            {primary.title}
          </span>
          <span className="kr-card-sub" data-kr-card-sub>
            {model.primaryReason}
          </span>
        </span>
      </a>
      {model.options && (
        <div className="kp-buttons kr-buttons">
          {DIRECTIONS.map(({ key, label, arrow, offNote }) => {
            const option = model.options?.[key];
            if (!option) {
              return (
                <span key={key} className="kr-btn kr-btn-off" aria-disabled="true">
                  <span className="kp-btn-label">{label}</span>
                  <span className="kr-btn-sub">{offNote}</span>
                </span>
              );
            }
            const sub = option.skipped
              ? `${BAND_LABEL[option.band]} — the nearest level with articles`
              : BAND_LABEL[option.band];
            return (
              <a key={key} className="kr-btn" href={option.candidates[0].href} data-kr-btn={key}>
                <span className="kp-btn-label">
                  {label} <span aria-hidden="true">{arrow}</span>
                </span>
                <span className="kr-btn-sub">{sub}</span>
              </a>
            );
          })}
        </div>
      )}
      {model.options && (
        <p className="kr-hint" data-kr-hint>
          Tip: flick Spark up for a harder one, down for an easier one, or double-tap Spark for the next article —
          or just tap the buttons.
        </p>
      )}
      <p className="kr-collection">
        <a href={model.collection.href}>{model.collection.label}</a>
      </p>
      {model.trackRead && (
        <p className="kr-fresh">
          <button type="button" className="text-button" data-kr-fresh>
            Start fresh
          </button>{' '}
          — forget which articles you’ve read on this device.
        </p>
      )}
    </section>
  );
}
