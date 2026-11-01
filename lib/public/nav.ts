import { getDb } from '@/lib/db';
import { brands } from '@/lib/config';
import { listWorlds, type World } from './worlds';

const launchWorlds = (): World[] =>
  Object.entries(brands).map(([slug, b], sort) => ({
    slug, name: b.name, promise: b.promise, description: b.description, icon: b.icon, color: b.color, sort,
  }));

// The worlds for the header, footer and home page. If the database is unreachable the five launch worlds keep navigation
// working; the page's own read then fails and shows the error page.
export async function navWorlds(): Promise<World[]> {
  try {
    return await listWorlds(getDb());
  } catch (err) {
    console.error('navWorlds: falling back to launch worlds:', (err as Error).message);
    return launchWorlds();
  }
}
