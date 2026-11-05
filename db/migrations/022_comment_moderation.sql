-- Comment moderation (Project 7B): members' reports on comments, authors' appeals, the moderation agent's role and the
-- columns its decisions write. Expand only: new tables and defaulted/nullable columns the previous release ignores
-- (every existing agent becomes role 'content', which is what it already is).
-- comment_reports keeps the weight the report carried when it was made, so a reporter's later trust change or deletion
-- (reporter set null, the report kept) never changes a past count. handled_at/dismissed: the agent's keep (dismissed)
-- or hide/reject. comment_appeals: one per comment, the author's own; both cascade with the comment.
-- Rollback: DROP TABLE comment_appeals; DROP TABLE comment_reports; ALTER TABLE comments DROP COLUMN escalated_at,
-- DROP COLUMN sampled_at, DROP COLUMN sample_reviewed_at, DROP COLUMN decided_by; ALTER TABLE account_trust
-- DROP COLUMN false_reports, DROP COLUMN reports_muted; ALTER TABLE agents DROP COLUMN role;
-- DELETE FROM schema_migrations WHERE name = '022_comment_moderation.sql'.
ALTER TABLE agents ADD COLUMN role text NOT NULL DEFAULT 'content' CHECK (role IN ('content', 'moderation'));

ALTER TABLE account_trust ADD COLUMN false_reports int NOT NULL DEFAULT 0 CHECK (false_reports >= 0);
ALTER TABLE account_trust ADD COLUMN reports_muted boolean NOT NULL DEFAULT false;

ALTER TABLE comments ADD COLUMN escalated_at timestamptz;
ALTER TABLE comments ADD COLUMN sampled_at timestamptz;
ALTER TABLE comments ADD COLUMN sample_reviewed_at timestamptz;
ALTER TABLE comments ADD COLUMN decided_by text;

CREATE TABLE comment_reports (
  id                  bigserial PRIMARY KEY,
  comment_id          uuid NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  reporter_account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  reason              text NOT NULL CHECK (reason IN ('abuse', 'personal_info', 'advertising', 'off_topic', 'other')),
  note                text CHECK (char_length(note) BETWEEN 1 AND 300),
  urgent              boolean NOT NULL DEFAULT false,
  weight              numeric(2, 1) NOT NULL CHECK (weight IN (0, 0.5, 1)),
  created_at          timestamptz NOT NULL DEFAULT now(),
  handled_at          timestamptz,
  dismissed           boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX comment_reports_once ON comment_reports (comment_id, reporter_account_id);
CREATE INDEX comment_reports_reporter_idx ON comment_reports (reporter_account_id, created_at);
CREATE INDEX comment_reports_open_idx ON comment_reports (comment_id) WHERE handled_at IS NULL;
CREATE INDEX comment_reports_urgent_idx ON comment_reports (created_at) WHERE urgent;

CREATE TABLE comment_appeals (
  id         bigserial PRIMARY KEY,
  comment_id uuid NOT NULL UNIQUE REFERENCES comments (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  note       text CHECK (char_length(note) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  outcome    text CHECK (outcome IN ('overturn', 'uphold')),
  CHECK ((outcome IS NULL) = (decided_at IS NULL))
);

CREATE INDEX comment_appeals_open_idx ON comment_appeals (created_at) WHERE decided_at IS NULL;
CREATE INDEX comments_moderation_idx ON comments (status, created_at) WHERE status IN ('held', 'hidden');
CREATE INDEX comments_sample_idx ON comments (created_at) WHERE sampled_at IS NOT NULL AND sample_reviewed_at IS NULL;
