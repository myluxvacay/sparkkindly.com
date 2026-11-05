-- Video jobs review fixes (Project 5B review M2, M3). Expand only: three nullable columns on video_jobs, which the
-- previous release never reads. captions_sha256: the caption file's checksum at upload; approved_captions_checksum: the
-- one the owner approved (re-checked at post time); captions_preview: the first 20 cue texts, shown on the job page so
-- the owner reads what will be published without the site ever serving the file.
-- Rollback: ALTER TABLE video_jobs DROP COLUMN captions_sha256, DROP COLUMN approved_captions_checksum,
--   DROP COLUMN captions_preview; DELETE FROM schema_migrations WHERE name = '031_video_captions_checksum.sql'.
ALTER TABLE video_jobs
  ADD COLUMN captions_sha256 text CHECK (captions_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN approved_captions_checksum text CHECK (approved_captions_checksum ~ '^[0-9a-f]{64}$'),
  ADD COLUMN captions_preview jsonb;
