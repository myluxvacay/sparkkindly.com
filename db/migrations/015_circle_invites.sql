-- Circle invites and referrals (Project 4B). A link invite is reusable until revoked; an email invite is single use and
-- expires 14 days after creation. Tokens are never stored: only their sha256 hashes. The invited address is kept only
-- until the invite is accepted, revoked or expired (lib/circles/invites.ts nulls it; the daily purge catches the rest).
-- A referral records that a new account first joined through an invite: invite, account and time, no names.
-- Expand only: two new tables the previous release never reads.
-- Rollback: DROP TABLE referrals; DROP TABLE circle_invites; DELETE FROM schema_migrations WHERE name = '015_circle_invites.sql'.
CREATE TABLE circle_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('link', 'email')),
  token_hash    text NOT NULL UNIQUE,
  invited_email text CHECK (invited_email IS NULL OR (kind = 'email' AND invited_email = lower(invited_email))),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  used_at       timestamptz,
  used_by       uuid REFERENCES accounts (id) ON DELETE SET NULL,
  opens         int NOT NULL DEFAULT 0,
  CHECK ((kind = 'email') = (expires_at IS NOT NULL)),
  CHECK (kind = 'email' OR used_at IS NULL)
);

CREATE INDEX circle_invites_circle_idx ON circle_invites (circle_id);
CREATE INDEX circle_invites_creator_idx ON circle_invites (created_by, created_at);
CREATE INDEX circle_invites_email_idx ON circle_invites (invited_email) WHERE invited_email IS NOT NULL;

CREATE TABLE referrals (
  invite_id      uuid NOT NULL REFERENCES circle_invites (id) ON DELETE CASCADE,
  new_account_id uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  joined_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX referrals_invite_idx ON referrals (invite_id);
