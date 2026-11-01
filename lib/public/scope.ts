import type { Audience } from '@/lib/items/repo';

export type { Audience };

// Who is asking, as far as a public read is concerned. Every read takes one, with no default, so a caller has to
// decide: audience is a safety filter, not a preference. An empty list matches nothing (fails closed).
export type Scope = { audiences: readonly Audience[]; now: Date };

// Anonymous visitors see every audience: `adults` means "aimed at adults", not an age gate (spec, Project 1).
// A child profile (Project 3) will pass ['kids', 'all'].
export function anonymousScope(now: Date = new Date()): Scope {
  return { audiences: ['kids', 'all', 'adults'], now };
}

// Top-level route names. A world whose slug equals one of these would shadow a page (or be shadowed by it), so /admin
// refuses them (Project 1C); a test keeps this list in step with the app directory.
export const RESERVED_WORLD_SLUGS: readonly string[] = [
  'admin', 'api', 'about', 'privacy', 'terms', 'accessibility', 'contact', 'editorial-policy',
  'quiz', 'search', 'topics', 'me', 'circles', 'report', 'community',
];
