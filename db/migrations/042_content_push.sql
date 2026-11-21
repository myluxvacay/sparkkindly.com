-- Content Push API (owner direction, 20 November 2026): the video component of an agent-pushed package.
-- The article/quiz items themselves live in `items` exactly like agent-submitted and legacy-imported items;
-- only the YouTube side needs its own record: the upload state machine (pending_upload -> private -> public,
-- with auth_expired / failed as surfaced error states and 'uploading' as the transient claim one processor
-- holds while it works, so two processors can never upload the same video twice), the metadata as submitted, and the privacy
-- the video currently carries. The watch URL is derived from youtube_id (lib/items/video watchUrl), never
-- stored, so the two cannot disagree. Additive only.
-- Rollback: DROP TABLE push_videos; DELETE FROM schema_migrations WHERE name = '042_content_push.sql'.
CREATE TABLE push_videos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        uuid NOT NULL UNIQUE REFERENCES items (id) ON DELETE CASCADE,
  state          text NOT NULL DEFAULT 'pending_upload'
                   CHECK (state IN ('pending_upload', 'uploading', 'private', 'public', 'auth_expired', 'failed')),
  youtube_id     text CHECK (youtube_id IS NULL OR youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  privacy_status text CHECK (privacy_status IS NULL OR privacy_status IN ('private', 'unlisted', 'public')),
  source_url     text,
  file_name      text,
  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',
  brand          text NOT NULL DEFAULT 'sparkkindly' CHECK (brand IN ('sparkkindly', 'mylux')),
  tags           jsonb NOT NULL DEFAULT '[]',
  made_for_kids  boolean NOT NULL DEFAULT false,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_videos_state ON push_videos (state);
