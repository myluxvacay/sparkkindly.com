-- Admin sign-in (Project 1C): an email link for allow-listed owners plus an authenticator code. Additive: new tables only.
-- The allow-list itself is configuration (ADMIN_EMAILS in the server's env file), not a table, so adding a second
-- approver is a config change. Tokens are never stored: only their sha256 hashes.

-- One row per enrolled authenticator, written by `npm run admin:totp`, never by a web page.
CREATE TABLE admin_users (
  email          text PRIMARY KEY CHECK (email = lower(email)),
  totp_secret    text NOT NULL,
  totp_last_step bigint NOT NULL DEFAULT 0,  -- the last accepted 30-second step, so a code cannot be replayed
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_login_tokens (
  token_hash text PRIMARY KEY,
  email      text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

-- stage 'code': the link was used but the authenticator code not yet given; such a session is not an admin.
CREATE TABLE admin_sessions (
  token_hash    text PRIMARY KEY,
  email         text NOT NULL,
  stage         text NOT NULL CHECK (stage IN ('code', 'active')),
  code_failures int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL
);

-- Once-per-period worker jobs (the daily digest) claim their period here before running.
CREATE TABLE job_runs (
  job     text NOT NULL,
  run_key text NOT NULL,
  at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job, run_key)
);

-- When an agent's key was last issued, so /admin and the digest can flag keys older than 90 days (spec section 7).
ALTER TABLE agents ADD COLUMN key_rotated_at timestamptz;
