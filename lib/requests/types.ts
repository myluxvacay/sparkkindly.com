// Request-a-Creation shared shapes (owner direction, 23 November 2026). A request names one of the
// printables categories and one delivered age band — the same taxonomy the sheets themselves carry
// (lib/printables.ts) — plus the How Things Work poster category, which families can already ask for
// ahead of its first sheets. No Next.js imports; the repo and submit modules build on these.
import { AGE_BANDS, PRINTABLE_CATEGORIES } from '../printables';

export type RequestStatus = 'pending' | 'approved' | 'declined' | 'created';
export const REQUEST_STATUSES: RequestStatus[] = ['pending', 'approved', 'declined', 'created'];

export type RequestCategory = { topic: string; name: string };

export const HOW_THINGS_WORK_CATEGORY: RequestCategory = { topic: 'printables-how-things-work', name: 'How Things Work' };

export const REQUEST_CATEGORIES: RequestCategory[] = [
  ...PRINTABLE_CATEGORIES.map((c) => ({ topic: c.topic, name: c.name })),
  HOW_THINGS_WORK_CATEGORY,
];

export const REQUEST_AGE_BANDS = AGE_BANDS;

const categoryByTopic = new Map(REQUEST_CATEGORIES.map((c) => [c.topic, c]));
const ageByTopic = new Map(REQUEST_AGE_BANDS.map((a) => [a.topic, a]));

export const isRequestCategory = (topic: string): boolean => categoryByTopic.has(topic);
export const isRequestAgeBand = (topic: string): boolean => ageByTopic.has(topic);
export const requestCategoryName = (topic: string): string => categoryByTopic.get(topic)?.name ?? topic;
export const requestAgeLabel = (topic: string): string => ageByTopic.get(topic)?.label ?? topic;

export type PrintableRequest = {
  id: string;
  categoryTopic: string;
  ageTopic: string;
  requestText: string;
  status: RequestStatus;
  createdUrl: string | null;
  meTooCount: number;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
};
