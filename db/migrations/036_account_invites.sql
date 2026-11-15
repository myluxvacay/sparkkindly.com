-- Account-addressed circle invites and leaderboard public keys (Project 4.11, ADR 0004). Expand only: a new
-- nullable column on circle_invites, one new constraint, and the kind CHECK widened in place (an IN-list — the
-- only kind of CHECK a migration replaces in place; see tests/unit/migrate.test.ts). The 015 shape CHECKs are
-- deliberately NOT touched: they force an account invite to carry no expires_at and never a used_at, so its
-- 14-day window runs from created_at and its acceptance is recorded in used_by, both enforced in
-- lib/circles/invites.ts. Every row the previous release can write still satisfies every constraint here.
-- accounts.public_key is the opaque handle the public leaderboard's invite links use instead of an account id
-- (the member_key pattern from 015): existing rows are filled by the per-row default.
-- Rollback: DROP INDEX circle_invites_account_idx; ALTER TABLE circle_invites DROP CONSTRAINT
-- circle_invites_account_shape, DROP COLUMN invited_account_id; ALTER TABLE circle_invites DROP CONSTRAINT
-- circle_invites_kind_check, ADD CONSTRAINT circle_invites_kind_check CHECK (kind IN ('link', 'email'));
-- DROP INDEX accounts_public_key; ALTER TABLE accounts DROP COLUMN public_key;
-- DELETE FROM schema_migrations WHERE name = '036_account_invites.sql'.
ALTER TABLE accounts
  ADD COLUMN public_key text NOT NULL DEFAULT left(replace(gen_random_uuid()::text, '-', ''), 16)
    CHECK (public_key ~ '^[0-9a-f]{16}$');
CREATE UNIQUE INDEX accounts_public_key ON accounts (public_key);

ALTER TABLE circle_invites
  ADD COLUMN invited_account_id uuid REFERENCES accounts (id) ON DELETE CASCADE;
ALTER TABLE circle_invites
  ADD CONSTRAINT circle_invites_account_shape CHECK ((kind = 'account') = (invited_account_id IS NOT NULL));
ALTER TABLE circle_invites
  DROP CONSTRAINT circle_invites_kind_check,
  ADD CONSTRAINT circle_invites_kind_check CHECK (kind IN ('link', 'email', 'account'));
CREATE INDEX circle_invites_account_idx ON circle_invites (invited_account_id) WHERE invited_account_id IS NOT NULL;
