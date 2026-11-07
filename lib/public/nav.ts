import { getDb } from '@/lib/db';
import { brands } from '@/lib/config';
import { listWorlds, type World } from './worlds';

const launchWorlds = (): World[] =>
  Object.entries(brands).map(([slug, b], sort) => ({
    slug, name: b.name, promise: b.promise, description: b.description, icon: b.icon, color: b.color, sort,
  }));

// The worlds for the header, footer and home page. If the database is unreachable the launch worlds in config keep navigation
// working; the page's own read then fails and shows the error page.
export async function navWorlds(): Promise<World[]> {
  try {
    return await listWorlds(getDb());
  } catch (err) {
    console.error('navWorlds: falling back to launch worlds:', (err as Error).message);
    return launchWorlds();
  }
}

// "Six worlds", "five worlds"...: the home page counts the enabled worlds instead of hard-coding the number.
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const worldCountWords = (n: number): string => `${WORDS[n] ?? n} world${n === 1 ? '' : 's'}`;
