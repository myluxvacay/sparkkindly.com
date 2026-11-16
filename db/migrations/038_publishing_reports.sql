-- Publishing reports for the admin publishing summary (/admin/publishing/): one row per daily content batch.
-- The reviewer agent writes the batch's published items and rejections (POST /api/agent/publishing/report/,
-- reviewer-role key); the promoter agent writes the batch's Facebook digest post (POST /api/agent/publishing/digest/,
-- promoter-role key). Published items are stored as the jobs reported them (world, kind, title, slug) so the page
-- shows exactly what was posted that day; rejections never became items, so their title and reason live only here.
-- report_received_at is set only by the review report: a batch row created by a digest write alone does not make
-- the day a "reported" day (the page still falls back to the items table for what was posted that day).
-- Expand only: three new tables; the previous release ignores them.
-- Rollback: DROP TABLE publishing_rejections, publishing_items, publishing_batches;
-- DELETE FROM schema_migrations WHERE name = '038_publishing_reports.sql'.

CREATE TABLE publishing_batches (
  batch_date         date PRIMARY KEY,
  report_received_at timestamptz,
  digest_post_url    text,
  digest_external_id text,
  digest_posted_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE publishing_items (
  id         bigserial PRIMARY KEY,
  batch_date date NOT NULL REFERENCES publishing_batches (batch_date) ON DELETE CASCADE,
  world      text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('article', 'activity', 'video', 'quiz')),
  title      text NOT NULL,
  slug       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX publishing_items_batch ON publishing_items (batch_date);

CREATE TABLE publishing_rejections (
  id         bigserial PRIMARY KEY,
  batch_date date NOT NULL REFERENCES publishing_batches (batch_date) ON DELETE CASCADE,
  title      text NOT NULL,
  world      text,
  kind       text CHECK (kind IS NULL OR kind IN ('article', 'activity', 'video', 'quiz')),
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX publishing_rejections_batch ON publishing_rejections (batch_date);
