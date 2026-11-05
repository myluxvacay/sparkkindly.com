-- Social distribution, the video jobs queue (Project 5B). Expand only: one new table. The previous release ignores it.
-- video_jobs: one row per video_script item and video platform (TikTok, YouTube), beside its distributions row, which
-- still carries the posting state (scheduled, posting, posted...). The job carries the brief (lib/social/video/brief.ts),
-- the uploaded file's server-generated name, SHA-256 and size (never the bytes; the file lives under SOCIAL_MEDIA_DIR,
-- outside the repo and never served), its validation result, the captions file, the owner's checksum-bound approval
-- and the maker note. state moves only through lib/social/video/states.ts.
-- Rollback (before deploying the previous release): UPDATE social_platforms SET enabled = false
--   WHERE platform IN ('tiktok', 'youtube');
-- then, only to remove everything: DROP TABLE video_jobs; DELETE FROM schema_migrations WHERE name = '030_video_jobs.sql'.
-- Media files under SOCIAL_MEDIA_DIR are removed by hand after the table (docs/OPERATIONS.md, Video jobs).
CREATE TABLE video_jobs (
  id                bigserial PRIMARY KEY,
  item_id           uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  platform          text NOT NULL CHECK (platform IN ('tiktok', 'youtube')),
  distribution_id   bigint NOT NULL UNIQUE REFERENCES distributions (id) ON DELETE CASCADE,
  state             text NOT NULL DEFAULT 'brief_pending'
                      CHECK (state IN ('brief_pending', 'brief_ready', 'uploaded', 'approved', 'cancelled')),
  brief             jsonb,
  version           int NOT NULL DEFAULT 1,
  maker_note        text CHECK (char_length(maker_note) <= 100),
  licence_note      text CHECK (char_length(licence_note) <= 200),
  origin            text NOT NULL DEFAULT 'owner-supplied' CHECK (origin = 'owner-supplied'),
  file_name         text CHECK (file_name ~ '^[0-9]+-[0-9a-f]{32}\.mp4$'),
  file_sha256       text CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size         bigint CHECK (file_size > 0),
  validation        jsonb,
  captions_path     text CHECK (captions_path ~ '^[0-9]+-[0-9a-f]{32}\.(vtt|srt)$'),
  captions_burned   boolean NOT NULL DEFAULT false,
  approved_checksum text CHECK (approved_checksum ~ '^[0-9a-f]{64}$'),
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, platform),
  CHECK ((state = 'approved') = (approved_checksum IS NOT NULL AND approved_at IS NOT NULL) OR state = 'cancelled')
);
CREATE INDEX video_jobs_state ON video_jobs (state, updated_at);
