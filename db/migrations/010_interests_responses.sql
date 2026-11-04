-- Interests and saved answers (Project 3D): what a profile cares about (topics and worlds, by id) and its first answer to
-- each playable item (correctness and time). A profile is the account holder's own (profile_id NULL) or one child profile.
-- Expand only: two new tables; the previous release ignores them.
-- Held about a child: topic/world ids and, per answered item, correct and answered_at. No page views, no free text.
-- A profile id must belong to the row's account: composite foreign key (profile_id, account_id) to child_profiles.
-- Deleting an account or a child profile cascades its rows. NULL profile_id (the holder) is made unique with COALESCE in
-- the indexes (NULLS NOT DISTINCT is not available on every supported PostgreSQL version).
-- Rollback: DROP TABLE item_responses; DROP TABLE profile_interests; DELETE FROM schema_migrations WHERE name = '010_interests_responses.sql'.
-- Before rolling back to any release older than the 3D Task 2 scope fix (public pages derive scope from the session),
-- run DELETE FROM account_sessions WHERE active_profile_id IS NOT NULL; or turn ACCOUNTS_ENABLED off: that code shows
-- `adults` items to a child session.
CREATE TABLE profile_interests (
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  profile_id uuid,
  topic_id   int REFERENCES topics (id) ON DELETE CASCADE,
  world_id   int REFERENCES worlds (id) ON DELETE CASCADE,
  CHECK (num_nonnulls(topic_id, world_id) = 1),
  FOREIGN KEY (profile_id, account_id) REFERENCES child_profiles (id, account_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX profile_interests_topic_uq
  ON profile_interests (account_id, COALESCE(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), topic_id)
  WHERE topic_id IS NOT NULL;
CREATE UNIQUE INDEX profile_interests_world_uq
  ON profile_interests (account_id, COALESCE(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), world_id)
  WHERE world_id IS NOT NULL;

CREATE TABLE item_responses (
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  profile_id  uuid,
  item_id     uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  correct     boolean NOT NULL,
  answered_at timestamptz NOT NULL,
  FOREIGN KEY (profile_id, account_id) REFERENCES child_profiles (id, account_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX item_responses_owner_item_uq
  ON item_responses (account_id, COALESCE(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), item_id);
CREATE INDEX item_responses_recent_idx ON item_responses (account_id, answered_at DESC);
