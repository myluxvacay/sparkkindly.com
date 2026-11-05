-- Invite email guards (4B security review). invite_address_log records each invite email actually sent, keyed by an
-- HMAC-SHA256 of the lower-cased address (key: UNSUBSCRIBE_SECRET with the label 'invite-address:'), so a site-wide cap
-- (3 per address per rolling 7 days, across every circle and sender) holds even after the daily purge nulls
-- circle_invites.invited_email; rows are pruned after 8 days by the invites purge. invite_suppressions holds the hashes
-- of addresses that chose "never email me invites again" from an invite email (no account needed); they get no invite
-- email. Neither table holds an address, only the keyed hash.
-- Expand only: two new tables the previous release never reads.
-- Rollback: DROP TABLE invite_suppressions; DROP TABLE invite_address_log;
-- DELETE FROM schema_migrations WHERE name = '017_invite_address_guard.sql'.
CREATE TABLE invite_address_log (
  addr_hash text NOT NULL CHECK (addr_hash ~ '^[0-9a-f]{64}$'),
  sent_at   timestamptz NOT NULL
);

CREATE INDEX invite_address_log_idx ON invite_address_log (addr_hash, sent_at);

CREATE TABLE invite_suppressions (
  addr_hash  text PRIMARY KEY CHECK (addr_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
