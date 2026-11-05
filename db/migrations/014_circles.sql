-- Circles (Project 4A): a named group of accounts (friends, family or community) and its members. A member is an account
-- or, in a family circle only, one of that account's child profiles. Each member has a name chosen for the circle; the
-- email is never shown to other members. Leaving keeps the row with left_at (4C shows "former member").
-- Expand only: two new tables the previous release never reads.
-- owner_account_id is a plain foreign key (no cascade): deleteAccountIn hands over or closes owned circles first, in the
-- same transaction. Only a closed circle may be left without an owner (its owner's account was deleted); the purge job
-- deletes closed circles 30 days after closed_at, and their member rows cascade.
-- Rollback: DROP TABLE circle_members; DROP TABLE circles; DELETE FROM schema_migrations WHERE name = '014_circles.sql'.
CREATE TABLE circles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]{10}$'),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  kind             text NOT NULL CHECK (kind IN ('friends', 'family', 'community')),
  description      text CHECK (char_length(description) <= 200),
  owner_account_id uuid REFERENCES accounts (id),
  time_zone        text NOT NULL DEFAULT 'UTC',
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at        timestamptz,
  hidden_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CHECK (owner_account_id IS NOT NULL OR status = 'closed')
);

CREATE INDEX circles_owner_idx ON circles (owner_account_id);
CREATE INDEX circles_closed_idx ON circles (closed_at) WHERE closed_at IS NOT NULL;

CREATE TABLE circle_members (
  circle_id    uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  profile_id   uuid,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 30),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  left_at      timestamptz,
  FOREIGN KEY (profile_id, account_id) REFERENCES child_profiles (id, account_id) ON DELETE CASCADE,
  CHECK (role = 'member' OR profile_id IS NULL)
);

CREATE UNIQUE INDEX circle_members_key
  ON circle_members (circle_id, account_id, COALESCE(profile_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX circle_members_account_idx ON circle_members (account_id);
