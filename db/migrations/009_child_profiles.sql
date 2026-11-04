-- Child profiles (Project 3C): a display name and an age band per child, owned by an adult account, plus the adult PIN
-- (scrypt hash and lockout counters), the guardian confirmation time and the session's active profile.
-- Expand only: a new table and nullable/defaulted columns; the previous release ignores them.
-- Held about a child: display name, age band, owner and created_at. Never an email, date of birth or free text.
-- Deleting an account cascades its profiles; deleting a profile sets any session's active_profile_id to NULL.
-- A session's active profile must belong to the session's account: composite foreign key (active_profile_id, account_id).
-- Release rollback: BEFORE switching back to a release that predates this migration, run
-- DELETE FROM account_sessions WHERE active_profile_id IS NOT NULL; (otherwise each child-profile session becomes a full adult session in the old code).
-- Schema rollback: ALTER TABLE account_sessions DROP COLUMN active_profile_id; DROP TABLE child_profiles (its UNIQUE (id, account_id) goes with it);
-- ALTER TABLE accounts DROP COLUMN guardian_confirmed_at, DROP COLUMN pin_hash, DROP COLUMN pin_failures, DROP COLUMN pin_lock_count,
-- DROP COLUMN pin_locked_until; DELETE FROM schema_migrations WHERE name = '009_child_profiles.sql'.
CREATE TABLE child_profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 30),
  age_band     text NOT NULL CHECK (age_band IN ('6-9', '10-12')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, account_id)
);

CREATE INDEX child_profiles_account_idx ON child_profiles (account_id);

ALTER TABLE accounts
  ADD COLUMN guardian_confirmed_at timestamptz,
  ADD COLUMN pin_hash text,
  ADD COLUMN pin_failures int NOT NULL DEFAULT 0,
  ADD COLUMN pin_lock_count int NOT NULL DEFAULT 0,
  ADD COLUMN pin_locked_until timestamptz;

ALTER TABLE account_sessions
  ADD COLUMN active_profile_id uuid,
  ADD FOREIGN KEY (active_profile_id, account_id) REFERENCES child_profiles (id, account_id)
    ON DELETE SET NULL (active_profile_id);
