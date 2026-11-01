-- "Report a problem" on every item (spec 4a.4). Additive: a new table only. A report records which item, why and what
-- the reader wrote; it deliberately stores nothing about who sent it. The admin queue that reads it is Project 1C.
CREATE TABLE problem_reports (
  id         bigserial PRIMARY KEY,
  item_id    uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  reason     text NOT NULL CHECK (reason IN ('wrong', 'unsafe', 'broken', 'other')),
  message    text NOT NULL DEFAULT '' CHECK (char_length(message) <= 1000),
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX problem_reports_status_created ON problem_reports (status, created_at DESC);
