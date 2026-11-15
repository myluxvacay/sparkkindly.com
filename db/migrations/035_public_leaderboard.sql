-- Public leaderboard (Project 4.11, ADR 0004): an account holder's opt-in, public display name and chosen avatar.
-- Expand only: three defaulted/nullable columns; the previous release ignores them. The opt-in defaults off, and a
-- public name or avatar is only ever set by the holder's own settings save (lib/accounts/leaderboard.ts), which also
-- requires the public_leaderboard capability (16+). Nothing about a child is stored here: child profiles are separate
-- rows in child_profiles and never appear on the board.
-- Rollback: ALTER TABLE accounts DROP COLUMN leaderboard_opt_in, DROP COLUMN public_name, DROP COLUMN avatar_key;
-- DELETE FROM schema_migrations WHERE name = '035_public_leaderboard.sql'.
ALTER TABLE accounts
  ADD COLUMN leaderboard_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN public_name text CHECK (public_name IS NULL OR char_length(public_name) BETWEEN 1 AND 30),
  ADD COLUMN avatar_key text CHECK (avatar_key IS NULL OR avatar_key ~ '^[a-z0-9-]{1,40}$');
