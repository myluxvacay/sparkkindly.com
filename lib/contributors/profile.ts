// Contributor profiles (plan 8): who may contribute, switching the role on, and reading a profile. The acting account
// comes only from the server-side context (requireAdultContext: a child context or none is refused); age group, consent
// and verification are re-read from the account row (share-locked, as a foreign key would), and a comment ban also
// blocks contributing. No Next.js imports. Verified by tests/unit/contributors-flow.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { requireAdultContext, type AccountContext } from '@/lib/accounts/context';
import { isUuid } from '@/lib/accounts/pin';
import { ageGroupFor, can, type AgeGroup, type Consent } from '@/lib/accounts/policy';
import { ticked } from '@/lib/comments/rules';
import { cleanBio, cleanContributorName, cleanLink, newProfileSlug } from './rules';

export type Eligible = { ok: true; accountId: string; group: AgeGroup } | { ok: false; code: 'not_allowed' | 'banned' };

// Must run inside the caller's transaction, first: it takes the account row's KEY SHARE lock (lock order: account,
// then contribution, then item, as in account deletion).
export async function eligibleContributor(tx: Queryable, ctx: AccountContext | null, now: Date): Promise<Eligible> {
  const adult = requireAdultContext(ctx);
  if (!adult || !isUuid(adult.account.id)) return { ok: false, code: 'not_allowed' };
  const r = await tx.query<{ dob: string; consent_state: Consent; verified: boolean; banned: boolean | null }>(
    `SELECT to_char(a.date_of_birth, 'YYYY-MM-DD') AS dob, a.consent_state, a.verified_at IS NOT NULL AS verified, t.banned
     FROM accounts a LEFT JOIN account_trust t ON t.account_id = a.id WHERE a.id = $1 FOR KEY SHARE OF a`,
    [adult.account.id],
  );
  const a = r.rows[0];
  const group = a ? ageGroupFor(a.dob, now) : null;
  if (!a || !a.verified || !group || !can(group, a.consent_state, 'contribute')) return { ok: false, code: 'not_allowed' };
  if (a.banned) return { ok: false, code: 'banned' };
  return { ok: true, accountId: adult.account.id, group };
}

export type Profile = {
  slug: string;
  displayName: string;
  bio: string | null;
  link: string | null;
  linkApproved: boolean;
  termsAcceptedAt: Date | null;
};

export async function getProfile(db: Queryable, accountId: string): Promise<Profile | null> {
  if (!isUuid(accountId)) return null;
  const r = await db.query<{ slug: string; display_name: string; bio: string | null; link: string | null; link_approved: boolean; terms_accepted_at: Date }>(
    'SELECT slug, display_name, bio, link, link_approved, terms_accepted_at FROM contributor_profiles WHERE account_id = $1',
    [accountId],
  );
  const p = r.rows[0];
  return p
    ? { slug: p.slug, displayName: p.display_name, bio: p.bio, link: p.link, linkApproved: p.link_approved, termsAcceptedAt: p.terms_accepted_at }
    : null;
}

export type EnableInput = { displayName: unknown; bio?: unknown; link?: unknown; terms?: unknown };
export type EnableCode = 'not_allowed' | 'banned' | 'terms' | 'name' | 'bio' | 'link';
export type EnableResult = { status: 'enabled'; slug: string } | { status: 'refused'; code: EnableCode };

type Cleaned = { name: string; bio: string | null; link: string | null } | { code: EnableCode };

// 16-17 contributors appear under their display name only (spec Project 8 "Minors"), so they cannot propose a link.
function clean(input: EnableInput, group: AgeGroup): Cleaned {
  const name = cleanContributorName(input.displayName);
  if (!name) return { code: 'name' };
  const bio = cleanBio(input.bio);
  if (bio === false) return { code: 'bio' };
  const link = cleanLink(input.link);
  if (link === false || (link !== null && group !== 'adult')) return { code: 'link' };
  return { name, bio, link };
}

// Switches the role on (terms required the first time) or updates the profile. A new or changed link is unapproved
// until the owner approves it.
export async function enableContributor(
  db: Db,
  ctx: AccountContext | null,
  input: EnableInput,
  now: Date,
): Promise<EnableResult> {
  return db.transaction(async (tx) => {
    const who = await eligibleContributor(tx, ctx, now);
    if (!who.ok) return { status: 'refused', code: who.code };
    const c = clean(input, who.group);
    if ('code' in c) return { status: 'refused', code: c.code };
    const existing = await getProfile(tx, who.accountId);
    if (!existing && !ticked(input.terms)) return { status: 'refused', code: 'terms' };
    const r = await tx.query<{ slug: string }>(
      `INSERT INTO contributor_profiles (account_id, slug, display_name, bio, link, terms_accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id) DO UPDATE SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio, link = EXCLUDED.link,
         link_approved = contributor_profiles.link_approved AND contributor_profiles.link IS NOT DISTINCT FROM EXCLUDED.link,
         updated_at = $6
       RETURNING slug`,
      [who.accountId, newProfileSlug(), c.name, c.bio, c.link, now.toISOString()],
    );
    return { status: 'enabled', slug: r.rows[0].slug };
  });
}
