// An owner-attached YouTube video on an item. Only the id is stored (items.video_youtube_id, set by the /admin
// item.video action); the page shows a preview served from our own server and loads youtube-nocookie.com only after the
// reader clicks play. No Next.js imports. Verified by tests/unit/item-video.test.ts.
import type { Queryable } from '@/lib/db';

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

// The video id from a youtube.com / youtu.be link (https only), or null for anything else.
export function parseYouTubeId(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  const id = u.hostname === 'youtu.be' ? parts[0] : parts[0] === 'watch' ? u.searchParams.get('v') : ['embed', 'shorts'].includes(parts[0]) ? parts[1] : null;
  return id && ID.test(id) ? id : null;
}

// The only place a preview is fetched from, and only by our server (the poster route), never by a visitor's browser.
export const posterSource = (id: string): string => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const embedSource = (id: string): string => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&cc_load_policy=1`;
export const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

export async function getVideoId(db: Queryable, itemId: string): Promise<string | null> {
  const r = await db.query<{ video_youtube_id: string | null }>('SELECT video_youtube_id FROM items WHERE id = $1', [itemId]);
  return r.rows[0]?.video_youtube_id ?? null;
}
