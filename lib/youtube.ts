// Watch & Follow — the YouTube catalogue data layer.
//
// The /watch/ page must stay current on its own: new channel videos appear without a code change.
// Two live tiers, both fetched server-side and cached for an hour:
//   (a) YouTube Data API v3 — active only when YOUTUBE_API_KEY is set in the server environment.
//       Reads the channel's uploads playlist in full, so the catalogue is complete, not just recent.
//   (b) The channel's public RSS feed — the launch tier. Carries only the latest ~15 videos, so it is
//       merged over the backfill list below (every video the pipeline published through 22 Nov 2026).
// Either tier failing leaves the page rendering from whatever remains — worst case the backfill alone.
// This module never throws.

export const YOUTUBE_CHANNEL_ID = 'UCM4Xc3JxrDSXNXw0uoPu4UQ';
// The uploads playlist id is the channel id with the leading "UC" swapped for "UU".
export const YOUTUBE_UPLOADS_PLAYLIST_ID = 'UUM4Xc3JxrDSXNXw0uoPu4UQ';
export const YOUTUBE_CHANNEL_URL = `https://www.youtube.com/channel/${YOUTUBE_CHANNEL_ID}`;

const RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
const REVALIDATE_SECONDS = 3600;

export type VideoKind = 'rhyme' | 'explainer';

export type WatchVideo = {
  id: string;
  title: string;
  kind: VideoKind;
  /** ISO timestamp; backfill entries use midday UTC on their publish date. */
  publishedAt: string;
};

// The two catalogue buckets are told apart by the titles the video pipeline itself sets:
// rhymes carry "Nursery Rhyme", everything else (the "SparkKindly Explains" series and specials)
// sits with the explainers.
export function classifyTitle(title: string): VideoKind {
  return /nursery rhyme/i.test(title) ? 'rhyme' : 'explainer';
}

// Every video published by the pipeline through Sun Nov 22, 2026, from the batch publish records
// (files/video-batches/batch-2026-11-18/published-*.txt and the Nov 19 run records). The Nov 19
// "Why Is the Sky Blue?" explainer was rendered but never uploaded, so it is deliberately absent.
export const BACKFILL_VIDEOS: WatchVideo[] = [
  { id: 'sG9GUGgDBm0', title: 'Old MacDonald Had a Farm 🐄 Nursery Rhyme for Kids | SparkKindly', kind: 'rhyme', publishedAt: '2026-11-18T12:00:00Z' },
  { id: 'Xz4oAQo9uEI', title: 'How Do Bees Make Honey? 🐝 | SparkKindly Explains', kind: 'explainer', publishedAt: '2026-11-18T12:00:00Z' },
  { id: '2ghzcaXpxOs', title: 'Twinkle Twinkle Little Star ⭐ Nursery Rhyme for Kids | SparkKindly', kind: 'rhyme', publishedAt: '2026-11-19T12:00:00Z' },
  { id: 'abh1J2VfwFM', title: 'The Wheels on the Bus 🚌 Nursery Rhyme for Kids | SparkKindly', kind: 'rhyme', publishedAt: '2026-11-20T12:00:00Z' },
  { id: 'kIbDeMUYygQ', title: 'Gettysburg, Pennsylvania — The Town Where History Turned 🇺🇸 | SparkKindly Explains', kind: 'explainer', publishedAt: '2026-11-20T12:00:00Z' },
  { id: 'GLRnKeyc3Kk', title: 'Itsy Bitsy Spider 🕷️ Nursery Rhyme for Kids | SparkKindly', kind: 'rhyme', publishedAt: '2026-11-21T12:00:00Z' },
  { id: 'jly0WXRlN-Y', title: 'How Does a Rainbow Happen? 🌈 | SparkKindly Explains', kind: 'explainer', publishedAt: '2026-11-21T12:00:00Z' },
  { id: 'UCXrgJ1P35Y', title: 'Baa Baa Black Sheep 🐑 Nursery Rhyme for Kids | SparkKindly', kind: 'rhyme', publishedAt: '2026-11-22T12:00:00Z' },
  { id: '0ZCVlrmxDJc', title: 'Why Do We See the Moon Change Shape? 🌙 | SparkKindly Explains', kind: 'explainer', publishedAt: '2026-11-22T12:00:00Z' },
];

function unescapeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Parse the channel RSS feed (Atom + yt:videoId). Pure, so it is unit-tested without a network. */
export function parseRssFeed(xml: string): WatchVideo[] {
  const videos: WatchVideo[] = [];
  for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
    const id = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]?.trim();
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1]?.trim();
    if (!id || !title || !published) continue;
    const cleanTitle = unescapeXml(title).trim();
    videos.push({ id, title: cleanTitle, kind: classifyTitle(cleanTitle), publishedAt: published });
  }
  return videos;
}

/** Merge lists by video id — later lists win (live data over backfill) — sorted newest first. Pure. */
export function mergeVideos(...lists: WatchVideo[][]): WatchVideo[] {
  const byId = new Map<string, WatchVideo>();
  for (const list of lists) for (const video of list) byId.set(video.id, video);
  return [...byId.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

async function fetchRssVideos(): Promise<WatchVideo[]> {
  try {
    const res = await fetch(RSS_URL, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) return [];
    return parseRssFeed(await res.text());
  } catch {
    return [];
  }
}

type PlaylistItemsResponse = {
  nextPageToken?: string;
  items?: { snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } } }[];
};

async function fetchApiVideos(apiKey: string): Promise<WatchVideo[]> {
  const videos: WatchVideo[] = [];
  let pageToken = '';
  // The uploads playlist is newest-first; 10 pages of 50 is far beyond any plausible catalogue size.
  for (let page = 0; page < 10; page++) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('playlistId', YOUTUBE_UPLOADS_PLAYLIST_ID);
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) break;
    const data = (await res.json()) as PlaylistItemsResponse;
    for (const item of data.items ?? []) {
      const id = item.snippet?.resourceId?.videoId;
      const title = item.snippet?.title;
      if (!id || !title || title === 'Private video' || title === 'Deleted video') continue;
      videos.push({ id, title, kind: classifyTitle(title), publishedAt: item.snippet?.publishedAt ?? '' });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return videos;
}

/**
 * The catalogue for /watch/: the API tier when YOUTUBE_API_KEY is set and answers, otherwise the RSS
 * tier — either way merged over the backfill so nothing published ever drops off the page.
 */
export async function getWatchVideos(): Promise<WatchVideo[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    try {
      const api = await fetchApiVideos(apiKey);
      if (api.length > 0) return mergeVideos(BACKFILL_VIDEOS, api);
    } catch {
      // Fall through to the RSS tier.
    }
  }
  return mergeVideos(BACKFILL_VIDEOS, await fetchRssVideos());
}
