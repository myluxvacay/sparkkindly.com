-- Circle reports (Project 4D): a current member reports their own circle with a reason and an optional note (up to 300
-- characters). The row keeps the circle, the reporter's account (set null when that account is deleted, so the report
-- survives without the reporter), the reason, the note and times; never a member's contact details. handled_at is set
-- by the site owner in /admin/circles/. Rows cascade with their circle.
-- Expand only: a new table the previous release never reads.
-- Rollback: DROP TABLE circle_reports; DELETE FROM schema_migrations WHERE name = '019_circle_reports.sql'.
CREATE TABLE circle_reports (
  id                  bigserial PRIMARY KEY,
  circle_id           uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  reporter_account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  reason              text NOT NULL CHECK (reason IN ('name', 'behaviour', 'safety', 'other')),
  note                text CHECK (char_length(note) BETWEEN 1 AND 300),
  created_at          timestamptz NOT NULL DEFAULT now(),
  handled_at          timestamptz
);

CREATE INDEX circle_reports_circle_idx ON circle_reports (circle_id, created_at DESC);
CREATE INDEX circle_reports_reporter_idx ON circle_reports (reporter_account_id, created_at);
