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

// The worlds from the brand kit (the five launch worlds plus Save, which migration 033 also adds to existing
// databases). Kids starts in review mode: nothing for children goes out unreviewed. Later worlds (for example Travel)
// are added in /admin, not here.
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
