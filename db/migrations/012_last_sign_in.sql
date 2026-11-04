-- Last sign-in (Project 3E): when the account last signed in by email link. Expired sessions are purged daily, so the
-- 24-month inactivity job (lib/accounts/inactivity.ts) needs this to never delete an account that signed in recently.
-- Expand only: a nullable column the previous release ignores; the backfill uses verified_at (a sign-in it knows of).
-- Rollback: ALTER TABLE accounts DROP COLUMN last_sign_in_at;
-- DELETE FROM schema_migrations WHERE name = '012_last_sign_in.sql'.
ALTER TABLE accounts ADD COLUMN last_sign_in_at timestamptz;
UPDATE accounts SET last_sign_in_at = verified_at WHERE verified_at IS NOT NULL;
