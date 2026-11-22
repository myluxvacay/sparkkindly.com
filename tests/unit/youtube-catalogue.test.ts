import { describe, expect, it } from 'vitest';
import { BACKFILL_VIDEOS, classifyTitle, mergeVideos, parseRssFeed, type WatchVideo } from '@/lib/youtube';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <entry>
  <id>yt:video:abc123XYZ09</id>
  <yt:videoId>abc123XYZ09</yt:videoId>
  <title>Fish &amp; Chips Day 🐟 Nursery Rhyme for Kids | SparkKindly</title>
  <published>2026-11-23T15:00:00+00:00</published>
 </entry>
 <entry>
  <id>yt:video:def456XYZ09</id>
  <yt:videoId>def456XYZ09</yt:videoId>
  <title>How Do Magnets Work? | SparkKindly Explains</title>
  <published>2026-11-23T14:00:00+00:00</published>
 </entry>
</feed>`;

describe('classifyTitle', () => {
  it('puts nursery rhymes in the rhyme bucket and everything else with the explainers', () => {
    expect(classifyTitle('Baa Baa Black Sheep 🐑 Nursery Rhyme for Kids | SparkKindly')).toBe('rhyme');
    expect(classifyTitle('How Do Bees Make Honey? 🐝 | SparkKindly Explains')).toBe('explainer');
  });
});

describe('parseRssFeed', () => {
  it('reads id, title (unescaped), kind and publish time from each entry', () => {
    const videos = parseRssFeed(FEED);
    expect(videos).toHaveLength(2);
    expect(videos[0]).toEqual({
      id: 'abc123XYZ09',
      title: 'Fish & Chips Day 🐟 Nursery Rhyme for Kids | SparkKindly',
      kind: 'rhyme',
      publishedAt: '2026-11-23T15:00:00+00:00',
    });
    expect(videos[1].kind).toBe('explainer');
  });

  it('returns nothing for a feed with no entries', () => {
    expect(parseRssFeed('<feed></feed>')).toEqual([]);
  });
});

describe('mergeVideos', () => {
  const older: WatchVideo = { id: 'x1', title: 'Backfill title', kind: 'rhyme', publishedAt: '2026-11-18T12:00:00Z' };
  const fresher: WatchVideo = { id: 'x1', title: 'Live title', kind: 'rhyme', publishedAt: '2026-11-18T17:30:00+00:00' };
  const newest: WatchVideo = { id: 'x2', title: 'Newest', kind: 'explainer', publishedAt: '2026-11-22T12:00:00Z' };

  it('dedupes by id with the later list winning, and sorts newest first', () => {
    const merged = mergeVideos([older], [fresher, newest]);
    expect(merged.map((v) => v.id)).toEqual(['x2', 'x1']);
    expect(merged[1].title).toBe('Live title');
  });
});

describe('BACKFILL_VIDEOS', () => {
  it('holds the nine videos published through Nov 22, 2026 — and not the never-uploaded Sky Blue explainer', () => {
    expect(BACKFILL_VIDEOS.map((v) => v.id)).toEqual(
      expect.arrayContaining([
        'sG9GUGgDBm0', 'Xz4oAQo9uEI', '2ghzcaXpxOs', 'abh1J2VfwFM', 'kIbDeMUYygQ',
        'GLRnKeyc3Kk', 'jly0WXRlN-Y', 'UCXrgJ1P35Y', '0ZCVlrmxDJc',
      ]),
    );
    expect(BACKFILL_VIDEOS).toHaveLength(9);
    expect(BACKFILL_VIDEOS.filter((v) => v.kind === 'rhyme')).toHaveLength(5);
    expect(BACKFILL_VIDEOS.filter((v) => v.kind === 'explainer')).toHaveLength(4);
  });
});
