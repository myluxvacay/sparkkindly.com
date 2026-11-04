-- Parental consent (Project 3B): when consent was given, when the reminder went out, and the parent's tokens.
-- Expand only: two nullable columns and a new table; the previous release ignores all three.
-- Tokens are never stored: only their sha256 hashes. Each is bound to the parent address it was sent to; a token whose
-- address no longer equals accounts.parent_email is invalid. A confirm token expires; a withdraw token does not.
-- Rollback: DROP TABLE account_consent_tokens; ALTER TABLE accounts DROP COLUMN consent_at, DROP COLUMN consent_reminded_at;
-- DELETE FROM schema_migrations WHERE name = '008_parental_consent.sql'.
ALTER TABLE accounts ADD COLUMN consent_at timestamptz, ADD COLUMN consent_reminded_at timestamptz;

CREATE TABLE account_consent_tokens (
  token_hash   text PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  parent_email text NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('confirm', 'withdraw')),
  expires_at   timestamptz,
  used_at      timestamptz
);

CREATE INDEX account_consent_tokens_account_idx ON account_consent_tokens (account_id);
