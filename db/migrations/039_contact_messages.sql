-- "Ask us a question" on the Contact page (owner request, 17 November 2026). Additive: a new table only, so the
-- previous release still runs against this schema. Unlike problem_reports, a contact message deliberately stores
-- the sender's email (and optional name) so the owner can reply; the privacy guide says so. The status column
-- mirrors problem_reports so a future admin queue can close messages the same way.
CREATE TABLE contact_messages (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL DEFAULT '' CHECK (char_length(name) <= 100),
  email      text NOT NULL CHECK (char_length(email) <= 254),
  topic      text NOT NULL CHECK (topic IN ('general', 'suggest', 'error', 'sponsorship', 'other')),
  message    text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_messages_status_created ON contact_messages (status, created_at DESC);
