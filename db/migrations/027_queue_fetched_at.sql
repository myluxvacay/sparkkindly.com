-- Hold-everything heartbeat (Project 7B review M2): its own column, written only when a moderation agent fetches its
-- queue, so authenticating, refused calls and decisions (which refresh agents.last_run_at) never keep instant
-- publishing open. Expand only; the previous release ignores it (and reads last_run_at as before). Existing moderation
-- agents start with NULL, so level-1 comments are held until the next queue fetch.
-- Rollback: ALTER TABLE agents DROP COLUMN queue_fetched_at; DELETE FROM schema_migrations WHERE name = '027_queue_fetched_at.sql'.
ALTER TABLE agents ADD COLUMN queue_fetched_at timestamptz;
