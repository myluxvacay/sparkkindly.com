-- Family Hub Phase 1 — the Spine (owner-approved scope, 27 November 2026;
-- files/family-hub-scope-2026-11-27.md in the goal workspace).
--
-- Table names carry a hub_ prefix on purpose: `circles` / `circle_members` already exist
-- (migration 014) as the SOCIAL circles system (friends/family/community play circles with
-- slugs, communities and score sets). The Hub's family-operations circles are a different
-- aggregate — private household data (schedules, runs, kid profiles with optional phone) that
-- must never mix with the social system — so they get their own tables with the same shapes.
--
-- Kid profiles are parent-managed rows, never accounts: first name + age group only, an
-- avatar id + colour (never a photo) and an optional parent-entered phone (typically a
-- teen's own device). age_group adds a Hub-only '13-17' band: rideshare teen eligibility
-- turns on it. The site's content banding (lib/age-bands.ts) is NOT changed.
--
-- Runs are NOT a separate table: a run is a hub_events row with is_run = true, and its
-- driver/status live on that row, so the calendar and the runs board can never disagree.
-- Recurrence is weekly-only in v1; run driver/status apply to the series (per-occurrence
-- overrides are a later phase if families need them).
-- Rollback: DROP TABLE hub_activity, hub_event_participants, hub_events, hub_kid_profiles,
--   hub_circle_invites, hub_circle_members, hub_circles;
--   DELETE FROM schema_migrations WHERE name = '050_family_hub.sql'.

CREATE TABLE hub_circles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  time_zone  text NOT NULL DEFAULT 'UTC',
  created_by uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hub_circle_members (
  circle_id  uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('organizer', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, user_id)
);

CREATE INDEX hub_circle_members_user_idx ON hub_circle_members (user_id);

CREATE TABLE hub_circle_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  invited_email text CHECK (invited_email IS NULL OR char_length(invited_email) <= 254),
  created_by    uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  accepted_by   uuid REFERENCES accounts (id) ON DELETE SET NULL,
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((accepted_at IS NULL) = (accepted_by IS NULL))
);

CREATE TABLE hub_kid_profiles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id  uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  first_name text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 30),
  age_group  text NOT NULL CHECK (age_group IN ('3-5', '6-8', '9-12', '13-17')),
  avatar_id  text NOT NULL DEFAULT 'spark',
  colour     text NOT NULL DEFAULT 'purple',
  phone      text CHECK (phone IS NULL OR char_length(phone) BETWEEN 5 AND 24),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hub_kid_profiles_circle_idx ON hub_kid_profiles (circle_id);

CREATE TABLE hub_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id        uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  recurrence       text CHECK (recurrence IS NULL OR recurrence = 'weekly'),
  recurrence_until date,
  location         text CHECK (location IS NULL OR char_length(location) <= 200),
  notes            text CHECK (notes IS NULL OR char_length(notes) <= 500),
  is_run           boolean NOT NULL DEFAULT false,
  driver_user_id   uuid REFERENCES accounts (id) ON DELETE SET NULL,
  run_status       text CHECK (run_status IN ('covered', 'uncovered', 'done')),
  created_by       uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK ((is_run AND run_status IS NOT NULL) OR (NOT is_run AND run_status IS NULL AND driver_user_id IS NULL)),
  CHECK (run_status <> 'covered' OR driver_user_id IS NOT NULL)
);

CREATE INDEX hub_events_circle_start_idx ON hub_events (circle_id, starts_at);

CREATE TABLE hub_event_participants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL REFERENCES hub_events (id) ON DELETE CASCADE,
  member_user_id uuid REFERENCES accounts (id) ON DELETE CASCADE,
  kid_profile_id uuid REFERENCES hub_kid_profiles (id) ON DELETE CASCADE,
  CHECK ((member_user_id IS NULL) <> (kid_profile_id IS NULL))
);

CREATE UNIQUE INDEX hub_event_participants_member_key ON hub_event_participants (event_id, member_user_id) WHERE member_user_id IS NOT NULL;
CREATE UNIQUE INDEX hub_event_participants_kid_key ON hub_event_participants (event_id, kid_profile_id) WHERE kid_profile_id IS NOT NULL;
CREATE INDEX hub_event_participants_event_idx ON hub_event_participants (event_id);

-- In-app notifications for v1: an attention/activity feed on the Hub home (uncovered runs are
-- derived live from hub_events; this table records what happened — claims, swaps, invites).
CREATE TABLE hub_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 40),
  message       text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 300),
  event_id      uuid REFERENCES hub_events (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hub_activity_circle_idx ON hub_activity (circle_id, created_at DESC);
