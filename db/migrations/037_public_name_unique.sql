-- Unique public leaderboard names (Project 4.11, ADR 0004; owner decision, 15 November 2026): two members may
-- not publish under the same display name, compared case-insensitively, so a board row's name always identifies
-- one member. Expand only: one partial unique index over the accounts that hold a name. Opting out keeps the
-- stored name (lib/accounts/leaderboard.ts), so an opted-out holder's name stays reserved by this index too.
-- The settings save pre-checks and maps this index's violation to a friendly "name taken" outcome.
-- Rollback: DROP INDEX accounts_public_name_unique; DELETE FROM schema_migrations WHERE name = '037_public_name_unique.sql'.
CREATE UNIQUE INDEX accounts_public_name_unique ON accounts (lower(public_name)) WHERE public_name IS NOT NULL;
