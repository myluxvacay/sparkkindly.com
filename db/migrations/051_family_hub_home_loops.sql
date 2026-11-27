-- Family Hub Phase 2 — the Home Loops (owner-approved scope, 27 November 2026;
-- files/family-hub-scope-2026-11-27.md in the goal workspace): M3 chores & points,
-- M4 meal planner, and the kid view.
--
-- Points integrity: a kid's balance is ALWAYS the sum of hub_points_ledger deltas — there is
-- no mutable counter anywhere. Points are created only by a parent's approval of a chore
-- completion or a parent's manual adjustment, and spent only by a parent's approval of a
-- redemption request; both write the ledger row in the same transaction as the state flip,
-- and the flip is guarded on the pending state so nothing can be decided twice. Every
-- balance-spending transaction locks the kid's profile row first, so concurrent decisions
-- for the same kid serialise and a balance can never be checked twice against the same
-- points. Ledger rows survive an adult leaving the circle (actor columns are ON DELETE
-- SET NULL): deleting the ledger would rewrite a child's balance, which must never happen
-- silently. The same applies to catalogue rows an adult created (chores, rewards,
-- favourites, plan entries): their created_by is SET NULL, never a cascade — a departing
-- adult must not take the family's lists with them.
--
-- Kid view: hub_kid_profiles gains a parent-set PIN (scrypt hash, same 'salt:hash' format as
-- lib/accounts/pin.ts) plus the account system's lockout shape (5 failures, 15 minutes).
-- A kid-view session is its OWN credential (hub_kid_view_sessions): an opaque token, stored
-- hashed, bound to exactly one (circle, kid profile). It is not the account session and
-- grants nothing outside that one kid view — the parent routes never read it and the kid
-- routes never read the account cookie. Setting a new PIN or clearing it revokes every
-- outstanding kid-view session for that profile.
-- Rollback: ALTER TABLE hub_points_ledger DROP CONSTRAINT hub_points_ledger_redemption_fk;
--   DROP TABLE hub_kid_view_sessions, hub_grocery_items, hub_meal_plan,
--   hub_meal_requests, hub_favourite_meals, hub_redemption_requests, hub_points_ledger,
--   hub_rewards, hub_chore_completions, hub_chores;
--   ALTER TABLE hub_kid_profiles DROP COLUMN dietary_notes, DROP COLUMN kid_view_pin_hash,
--   DROP COLUMN kid_view_pin_failures, DROP COLUMN kid_view_pin_locked_until;
--   DELETE FROM schema_migrations WHERE name = '051_family_hub_home_loops.sql'.

ALTER TABLE hub_kid_profiles
  ADD COLUMN dietary_notes text CHECK (dietary_notes IS NULL OR char_length(dietary_notes) <= 500),
  ADD COLUMN kid_view_pin_hash text,
  ADD COLUMN kid_view_pin_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN kid_view_pin_locked_until timestamptz;

CREATE TABLE hub_kid_view_sessions (
  token_hash    text PRIMARY KEY,
  circle_id     uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  kid_profile_id uuid NOT NULL REFERENCES hub_kid_profiles (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

CREATE INDEX hub_kid_view_sessions_kid_idx ON hub_kid_view_sessions (kid_profile_id);

CREATE TABLE hub_chores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  kid_profile_id uuid NOT NULL REFERENCES hub_kid_profiles (id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  cadence       text NOT NULL CHECK (cadence IN ('daily', 'weekly', 'one_off')),
  points        integer NOT NULL CHECK (points BETWEEN 1 AND 10000),
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES accounts (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hub_chores_circle_kid_idx ON hub_chores (circle_id, kid_profile_id);

-- One completion per chore per period. period_key is the circle-local day for a daily chore
-- ('2026-11-27'), the circle-local Monday for a weekly chore, and 'once' for a one-off.
CREATE TABLE hub_chore_completions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chore_id      uuid NOT NULL REFERENCES hub_chores (id) ON DELETE CASCADE,
  circle_id     uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  kid_profile_id uuid NOT NULL REFERENCES hub_kid_profiles (id) ON DELETE CASCADE,
  period_key    text NOT NULL CHECK (char_length(period_key) BETWEEN 1 AND 16),
  state         text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'declined')),
  marked_at     timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES accounts (id) ON DELETE SET NULL,
  decided_at    timestamptz,
  UNIQUE (chore_id, period_key),
  CHECK ((state = 'pending') = (decided_at IS NULL))
);

CREATE INDEX hub_chore_completions_circle_state_idx ON hub_chore_completions (circle_id, state);

CREATE TABLE hub_points_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  kid_profile_id uuid NOT NULL REFERENCES hub_kid_profiles (id) ON DELETE CASCADE,
  delta         integer NOT NULL CHECK (delta <> 0),
  reason        text NOT NULL CHECK (reason IN ('chore_approval', 'reward_redemption', 'adjustment')),
  completion_id uuid REFERENCES hub_chore_completions (id) ON DELETE SET NULL,
  redemption_id uuid,
  note          text CHECK (note IS NULL OR char_length(note) <= 300),
  created_by    uuid REFERENCES accounts (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hub_points_ledger_kid_idx ON hub_points_ledger (kid_profile_id, created_at);

CREATE TABLE hub_rewards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  cost_points   integer NOT NULL CHECK (cost_points BETWEEN 1 AND 100000),
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES accounts (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hub_rewards_circle_idx ON hub_rewards (circle_id);

-- A redemption is a request a parent approves (the scope's approval pattern); the ledger
-- entry is written on approval and linked back here. cost_points is a snapshot of the
-- catalogue price at request time, so a later price edit never changes a pending request.
CREATE TABLE hub_redemption_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  kid_profile_id uuid NOT NULL REFERENCES hub_kid_profiles (id) ON DELETE CASCADE,
  reward_id     uuid NOT NULL REFERENCES hub_rewards (id) ON DELETE CASCADE,
  cost_points   integer NOT NULL CHECK (cost_points BETWEEN 1 AND 100000),
  state         text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'declined')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES accounts (id) ON DELETE SET NULL,
  decided_at    timestamptz,
  ledger_entry_id uuid REFERENCES hub_points_ledger (id) ON DELETE SET NULL,
  CHECK ((state = 'pending') = (decided_at IS NULL))
);

CREATE INDEX hub_redemption_requests_circle_state_idx ON hub_redemption_requests (circle_id, state);

CREATE UNIQUE INDEX hub_redemption_requests_pending_key ON hub_redemption_requests (kid_profile_id, reward_id) WHERE state = 'pending';

ALTER TABLE hub_points_ledger
  ADD CONSTRAINT hub_points_ledger_redemption_fk
  FOREIGN KEY (redemption_id) REFERENCES hub_redemption_requests (id) ON DELETE SET NULL;

CREATE TABLE hub_favourite_meals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  created_by    uuid REFERENCES accounts (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hub_favourite_meals_circle_idx ON hub_favourite_meals (circle_id);

-- Meal requests come from kid profiles only (scope M4); adults plan directly on the board.
CREATE TABLE hub_meal_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  kid_profile_id uuid NOT NULL REFERENCES hub_kid_profiles (id) ON DELETE CASCADE,
  favourite_id  uuid REFERENCES hub_favourite_meals (id) ON DELETE SET NULL,
  requested_text text NOT NULL CHECK (char_length(requested_text) BETWEEN 1 AND 80),
  desired_day   date,
  state         text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'declined')),
  decline_message text CHECK (decline_message IS NULL OR char_length(decline_message) <= 300),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES accounts (id) ON DELETE SET NULL,
  decided_at    timestamptz,
  CHECK ((state = 'pending') = (decided_at IS NULL))
);

CREATE INDEX hub_meal_requests_circle_state_idx ON hub_meal_requests (circle_id, state);

CREATE TABLE hub_meal_plan (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  plan_date     date NOT NULL,
  meal_text     text NOT NULL CHECK (char_length(meal_text) BETWEEN 1 AND 80),
  kid_profile_id uuid REFERENCES hub_kid_profiles (id) ON DELETE SET NULL,
  source_request_id uuid UNIQUE REFERENCES hub_meal_requests (id) ON DELETE SET NULL,
  created_by    uuid REFERENCES accounts (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hub_meal_plan_circle_date_idx ON hub_meal_plan (circle_id, plan_date);

CREATE TABLE hub_grocery_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid NOT NULL REFERENCES hub_circles (id) ON DELETE CASCADE,
  meal_plan_id  uuid REFERENCES hub_meal_plan (id) ON DELETE CASCADE,
  item_text     text NOT NULL CHECK (char_length(item_text) BETWEEN 1 AND 80),
  quantity_text text CHECK (quantity_text IS NULL OR char_length(quantity_text) <= 40),
  checked       boolean NOT NULL DEFAULT false,
  added_by      uuid REFERENCES accounts (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hub_grocery_items_circle_idx ON hub_grocery_items (circle_id, created_at);
