import { brands } from '@/lib/config';

export type WorldSeed = {
  slug: string;
  name: string;
  promise: string;
  description: string;
  icon: string;
  color: string;
  sort: number;
  approvalMode: 'auto' | 'review';
};

// The five launch worlds, taken from the brand kit. Kids starts in review mode: nothing for children goes out
// unreviewed. Later worlds (for example Travel) are added in /admin, not here.
export const worldSeeds: WorldSeed[] = Object.entries(brands).map(([slug, b], i) => ({
  slug,
  name: b.name,
  promise: b.promise,
  description: b.description,
  icon: b.icon,
  color: b.color,
  sort: i,
  approvalMode: slug === 'kids' ? 'review' : 'auto',
}));
