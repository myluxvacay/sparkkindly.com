import type { ArticleView } from '@/lib/public/body';

// Legacy video items: the player when a finished video with captions exists (video never ships without captions),
// the production status while it does not, and the descriptive transcript either way.
export default function VideoBlock({ article }: { article: ArticleView }) {
  const playable = article.videoSrc && article.captionsSrc;
  if (!playable && !article.productionStatus && !article.transcript) return null;
  return (
    <div className="container article-media">
      {playable && (
        <video controls preload="none" width={1200}>
          <source src={article.videoSrc} />
          <track kind="captions" src={article.captionsSrc} srcLang="en" label="English" default />
        </video>
      )}
      {article.productionStatus === 'in-production' && (
        <p className="media-caption">Pilot in production · Illustrative reference image, not a frame from a finished film.</p>
      )}
      {article.transcript && (
        <section id="transcript">
          <h2>Transcript</h2>
          <p>{article.transcript}</p>
        </section>
      )}
    </div>
  );
}
