-- Family Hub Phase 2.5 — PWA Web Push (owner-approved scope, 27 November 2026;
-- files/family-hub-scope-2026-11-27.md in the goal workspace): push subscriptions for
-- circle adults. One row per browser push endpoint; the endpoint is the identity of a
-- device subscription, so it is UNIQUE and re-subscribing from the same browser moves
-- the row to the account that subscribed. A user only ever manages rows whose user_id
-- is their own (enforced in lib/family-hub/push.ts, not by callers). The p256dh/auth
-- pair is the subscription's own key material — it can only be used to send pushes TO
-- that endpoint, never to read anything — but it is still per-user data: it is never
-- exposed outside the circle member who owns it and dies with the account (CASCADE).
-- Dead endpoints (push service answers 404/410) are pruned by the sender.
-- Rollback: DROP TABLE hub_push_subscriptions;
--   DELETE FROM schema_migrations WHERE name = '052_family_hub_push.sql'.

CREATE TABLE hub_push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE CHECK (char_length(endpoint) BETWEEN 1 AND 1000),
  p256dh      text NOT NULL CHECK (char_length(p256dh) BETWEEN 1 AND 500),
  auth        text NOT NULL CHECK (char_length(auth) BETWEEN 1 AND 500),
  user_agent  text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hub_push_subscriptions_user_idx ON hub_push_subscriptions (user_id);
