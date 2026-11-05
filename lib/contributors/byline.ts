// What the public sees of contributors (plan 8): the "By <name>" byline on a published contributed item, the contributor
// page and the sitemap's contributor entries. Only `approved` contributions whose item is visible (the shared
// visibleWhere predicate) count, so a withdrawn, archived or deleted contributor's piece shows no byline. Display name
// and the random page id only: never an email or account id. A link shows only once the owner approved it and only
// for an adult (16-17 contributors appear under their display name only). Everything is null with the flag off.
// No Next.js imports. Verified by tests/unit/contributors-public.test.ts.
import { isUuid } from '@/lib/accounts/pin';
import { ageGroupFor } from '@/lib/accounts/policy';
import { contributorsEnabled } from '@/lib/config';
import type { Queryable } from '@/lib/db';
import { PUBLIC_SELECT, toPublic, type PublicItem } from '@/lib/items/repo';
import { visibleWhere } from '@/lib/public/reads';
import { anonymousScope, type Scope } from '@/lib/public/scope';

export type Byline = { name: string; slug: string };

const CREDITED = `EXISTS (SELECT 1 FROM contributions c WHERE c.item_id = i.id AND c.state = 'approved' AND c.account_id = p.account_id)`;

export async function bylineFor(db: Queryable, itemId: string): Promise<Byline | null> {
  if (!contributorsEnabled() || !isUuid(itemId)) return null;
  const r = await db.query<Byline>(
    `SELECT p.display_name AS name, p.slug FROM items i JOIN contributions c ON c.item_id = i.id
     JOIN contributor_profiles p ON p.account_id = c.account_id
     WHERE i.id = $1 AND i.status = 'published' AND c.state = 'approved'`,
    [itemId],
  );
  return r.rows[0] ?? null;
}

const PAGE_LIMIT = 50;
export type ContributorPage = { displayName: string; bio: string | null; link: string | null; items: PublicItem[] };

export async function contributorPage(db: Queryable, slug: string, scope: Scope): Promise<ContributorPage | null> {
  if (!contributorsEnabled() || !/^[a-z0-9]{10}$/.test(slug)) return null;
  const prof = await db.query<{ account_id: string; display_name: string; bio: string | null; link: string | null; link_approved: boolean; dob: string }>(
    `SELECT p.account_id, p.display_name, p.bio, p.link, p.link_approved, to_char(a.date_of_birth, 'YYYY-MM-DD') AS dob
     FROM contributor_profiles p JOIN accounts a ON a.id = p.account_id WHERE p.slug = $1`,
    [slug],
  );
  const p = prof.rows[0];
  if (!p) return null;
  const items = await db.query<Record<string, unknown>>(
    `${PUBLIC_SELECT} WHERE ${visibleWhere('$1', '$2')}
       AND EXISTS (SELECT 1 FROM contributions c WHERE c.item_id = i.id AND c.state = 'approved' AND c.account_id = $3)
     ORDER BY i.published_at DESC, i.id LIMIT ${PAGE_LIMIT}`,
    [scope.now, [...scope.audiences], p.account_id],
  );
  if (!items.rows.length) return null;
  const adult = ageGroupFor(p.dob, scope.now) === 'adult';
  return {
    displayName: p.display_name,
    bio: p.bio,
    link: p.link_approved && adult ? p.link : null,
    items: items.rows.map(toPublic),
  };
}

// Contributor pages for the sitemap: those with at least one publicly visible item.
export async function contributorSlugs(db: Queryable, now: Date): Promise<string[]> {
  if (!contributorsEnabled()) return [];
  const s = anonymousScope(now);
  const r = await db.query<{ slug: string }>(
    `SELECT p.slug FROM contributor_profiles p
     WHERE EXISTS (SELECT 1 FROM items i JOIN worlds w ON w.id = i.world_id WHERE ${visibleWhere('$1', '$2')} AND ${CREDITED})
     ORDER BY p.slug`,
    [s.now, [...s.audiences]],
  );
  return r.rows.map((x) => x.slug);
}
