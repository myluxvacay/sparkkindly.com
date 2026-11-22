'use client';
import { useState } from 'react';
import type { VideoKind, WatchVideo } from '@/lib/youtube';

// Lite-embed: the grid ships thumbnails only — no YouTube iframe exists until a visitor presses
// play, when that one card swaps in the youtube-nocookie embed. Keeps /watch/ light on load.
const FILTERS: { key: VideoKind | 'all'; label: string }[] = [
  { key: 'all', label: 'All videos' },
  { key: 'rhyme', label: 'Nursery Rhymes' },
  { key: 'explainer', label: 'How It Works Explainers' },
];

const KIND_LABEL: Record<VideoKind, string> = {
  rhyme: 'Nursery Rhyme',
  explainer: 'How It Works Explainer',
};

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(iso),
  );

export default function WatchCatalogue({ videos }: { videos: WatchVideo[] }) {
  const [filter, setFilter] = useState<VideoKind | 'all'>('all');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const shown = filter === 'all' ? videos : videos.filter((v) => v.kind === filter);
  return (
    <>
      <div className="watch-chips" role="group" aria-label="Filter videos">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={filter === f.key ? 'watch-chip active' : 'watch-chip'}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="muted">No videos in this list yet — check back soon.</p>
      ) : (
        <ul className="watch-grid">
          {shown.map((video) => (
            <li key={video.id} className="watch-card">
              <div className="watch-media">
                {playingId === video.id ? (
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`}
                    title={video.title}
                    loading="lazy"
                    allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <button
                    type="button"
                    className="watch-thumb"
                    onClick={() => setPlayingId(video.id)}
                    aria-label={`Play video: ${video.title}`}
                  >
                    <img
                      src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
                      alt=""
                      width={480}
                      height={360}
                      loading="lazy"
                    />
                    <span className="watch-play" aria-hidden="true">▶</span>
                  </button>
                )}
              </div>
              <div className="watch-card-body">
                <p className="card-meta">
                  <span className={video.kind === 'rhyme' ? 'brand-label coral' : 'brand-label sky'}>
                    {KIND_LABEL[video.kind]}
                  </span>
                  <span>{fmtDate(video.publishedAt)}</span>
                </p>
                <h3>{video.title}</h3>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
