-- Settings (Project 3E): three notification preferences, all off by default, and when the 24-month inactivity notice
-- went out. Expand only: defaulted and nullable columns; the previous release ignores them.
-- Rollback: ALTER TABLE accounts DROP COLUMN notify_daily_set, DROP COLUMN notify_weekly_circle,
-- DROP COLUMN notify_invites, DROP COLUMN inactivity_notice_at;
-- DELETE FROM schema_migrations WHERE name = '011_settings.sql'.
ALTER TABLE accounts
  ADD COLUMN notify_daily_set boolean NOT NULL DEFAULT false,
  ADD COLUMN notify_weekly_circle boolean NOT NULL DEFAULT false,
  ADD COLUMN notify_invites boolean NOT NULL DEFAULT false,
  ADD COLUMN inactivity_notice_at timestamptz;
