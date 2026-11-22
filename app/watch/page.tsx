import Breadcrumb from '@/components/Breadcrumb';
import WatchCatalogue from '@/components/WatchCatalogue';
import { site } from '@/lib/config';
import { metadata as seo } from '@/lib/seo';
import { getWatchVideos, YOUTUBE_CHANNEL_URL } from '@/lib/youtube';

export function generateMetadata() {
  return seo(
    'Watch & Follow',
    'Watch SparkKindly videos right here — nursery rhymes and How It Works explainers for curious kids — and follow SparkKindly on YouTube, Facebook, Instagram and TikTok.',
    '/watch/',
  );
}

const SOCIAL_CARDS = [
  {
    name: 'YouTube',
    handle: 'SparkKindly',
    blurb: 'Every rhyme and explainer video, fresh each day. Subscribe so the newest one finds you.',
    href: YOUTUBE_CHANNEL_URL,
    action: 'Visit & subscribe',
  },
  {
    name: 'Facebook',
    handle: 'SparkKindly',
    blurb: 'Daily questions, new lessons and videos on our Facebook Page — come and say hello.',
    href: site.socials.facebook ?? 'https://www.facebook.com/profile.php?id=61592978620272',
    action: 'Visit the Page',
  },
  {
    name: 'Instagram',
    handle: '@sparkkindly',
    blurb: 'Reels and little sparks of learning from Spark, over on Instagram.',
    href: site.socials.instagram ?? 'https://www.instagram.com/sparkkindly/',
    action: 'Follow on Instagram',
  },
  {
    name: 'TikTok',
    handle: '@sparkkindly',
    blurb: 'Our short videos on TikTok — rhymes and explainers in bite-size form.',
    href: site.socials.tiktok ?? 'https://www.tiktok.com/@sparkkindly',
    action: 'Follow on TikTok',
  },
];

// Watch & Follow: one home for SparkKindly video. The catalogue below is fed by lib/youtube.ts —
// the channel RSS feed (or the YouTube Data API when YOUTUBE_API_KEY is set) merged over a backfill
// of everything published through Nov 22, 2026 — so new videos appear here on their own.
export default async function WatchPage() {
  const videos = await getWatchVideos();
  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Watch & Follow' }]} />
      <p className="eyebrow">SING, WATCH, WONDER</p>
      <h1>Watch &amp; Follow</h1>
      <p className="intro-text">
        All of SparkKindly&apos;s videos live here — press play and watch right on this page, no trip to
        YouTube needed. New rhymes and explainers arrive every day, and this shelf refills itself.
      </p>

      <h2 className="watch-heading">Find us everywhere</h2>
      <ul className="social-grid">
        {SOCIAL_CARDS.map((card) => (
          <li key={card.name} className="social-card">
            <p className="eyebrow">{card.name}</p>
            <h3>{card.handle}</h3>
            <p>{card.blurb}</p>
            <a className="button" href={card.href} target="_blank" rel="noopener noreferrer">
              {card.action} <span aria-hidden="true">↗</span>
            </a>
          </li>
        ))}
      </ul>

      <h2 className="watch-heading">Watch the videos</h2>
      <p>
        Nursery rhymes to sing along with, and How It Works explainers that answer the questions kids
        actually ask. Pick a video and it plays right here.
      </p>
      <WatchCatalogue videos={videos} />
      <p className="muted">
        Prefer YouTube itself? Everything above — and the very newest videos — is on{' '}
        <a href={YOUTUBE_CHANNEL_URL} target="_blank" rel="noopener noreferrer">
          the SparkKindly YouTube channel
        </a>
        .
      </p>
    </div>
  );
}
