-- Accounts (Project 3A): member accounts, sign-in links and sessions. Additive: new tables only.
-- Only the date of birth is stored, never the age group (it is derived by lib/accounts/policy.ts).
-- Tokens are never stored: only their sha256 hashes (same shape as the admin_* tables, without a stage).
-- Rollback (nothing else depends on these): DROP TABLE account_sessions, account_login_tokens, accounts;
-- DELETE FROM schema_migrations WHERE name = '007_accounts.sql'.
CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email) AND email = btrim(email)),
  date_of_birth date NOT NULL,
  time_zone     text NOT NULL DEFAULT 'UTC',
  consent_state text NOT NULL DEFAULT 'none' CHECK (consent_state IN ('none', 'pending', 'confirmed')),
  parent_email  text CHECK (parent_email IS NULL OR parent_email = lower(parent_email)),
  -- Set once, when the first sign-in link for the address is used. Until then a sign-up for the same address replaces
  -- the row (stops someone registering a victim's address first); after it, a sign-up never changes the account.
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (consent_state <> 'none' OR parent_email IS NULL),
  CHECK (parent_email IS NULL OR parent_email <> email)
);

CREATE TABLE account_login_tokens (
  token_hash text PRIMARY KEY,
  email      text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

CREATE TABLE account_sessions (
  token_hash   text PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);

CREATE INDEX account_sessions_account_idx ON account_sessions (account_id);
