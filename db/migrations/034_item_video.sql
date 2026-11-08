-- An owner-attached YouTube video on an article (owner decision, 8 November 2026). Expand only: one nullable column
-- holding the 11-character video id, set only by the /admin item.video action (agents never write it). Nothing is
-- requested from YouTube until a reader clicks play. The previous release ignores the column.
-- Rollback: UPDATE items SET video_youtube_id = NULL; ALTER TABLE items DROP COLUMN video_youtube_id;
--   DELETE FROM schema_migrations WHERE name = '034_item_video.sql'.
ALTER TABLE items ADD COLUMN video_youtube_id text CHECK (video_youtube_id ~ '^[A-Za-z0-9_-]{11}$');
