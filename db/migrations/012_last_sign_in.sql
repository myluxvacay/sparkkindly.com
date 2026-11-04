-- Last activity (Project 3E): when the account last signed in by email link, and when one of its sessions was last
-- used (kept to the hour by the session refresh). Expired sessions are purged daily, so the 24-month inactivity job
-- (lib/accounts/inactivity.ts) needs these to never delete an account that signed in or browsed recently.
-- Expand only: nullable columns the previous release ignores. The backfill uses what is known today: verified_at
-- (a sign-in) and any live session's last_seen_at.
-- Rollback: ALTER TABLE accounts DROP COLUMN last_sign_in_at, DROP COLUMN last_seen_at;
-- DELETE FROM schema_migrations WHERE name = '012_last_sign_in.sql'.
ALTER TABLE accounts ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN last_seen_at timestamptz;
UPDATE accounts SET last_sign_in_at = verified_at WHERE verified_at IS NOT NULL;
UPDATE accounts a SET last_seen_at = GREATEST(
  a.last_sign_in_at,
  (SELECT max(s.last_seen_at) FROM account_sessions s WHERE s.account_id = a.id)
)
WHERE a.verified_at IS NOT NULL;
