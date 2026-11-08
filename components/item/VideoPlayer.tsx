'use client';
import { useState } from 'react';
import { embedSource, watchUrl } from '@/lib/items/video';

// An owner-attached YouTube video. Until the reader presses play the page shows only a preview served from our own
// server and a button; the YouTube player (youtube-nocookie.com) is requested only after the press. Without JavaScript
// the "Watch on YouTube" link still works.
export default function VideoPlayer({ id, poster, title }: { id: string; poster: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <figure className="video-player">
      <div className="video-frame">
        {playing ? (
          <iframe
            src={embedSource(id)}
            title={`Video: ${title}`}
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <>
            <img src={poster} width={1280} height={720} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />
            <button type="button" className="video-play" onClick={() => setPlaying(true)}>
              <span aria-hidden="true">▶</span> Play video
              <span className="visually-hidden">: {title}</span>
            </button>
          </>
        )}
      </div>
      <figcaption className="media-caption">
        Playing loads the video from YouTube, which may set its own cookies. <a href={watchUrl(id)} rel="noopener noreferrer">Watch on YouTube</a>
      </figcaption>
    </figure>
  );
}
