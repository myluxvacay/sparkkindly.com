-- Request-a-Creation (owner direction, 23 November 2026): visitors who cannot find the printable they
-- want ask for it — "a counting sheet with dinosaurs" — and the most-wanted requests get made. A request
-- is a moderation-queue row, never content: it lands 'pending', invisible everywhere, and only an admin
-- decision in /admin/requests/ moves it to 'approved' (shown on the public Fresh Requests shelf),
-- 'declined' (never shown) or 'created' (shown as Made!, linking the published item).
-- No personal data exists anywhere in this design: no name, no email, no account. The submitter/voter
-- columns hold only a keyed HMAC of the client network prefix (IPv4 /24, IPv6 /64; + user agent for
-- votes), kept so one neighbourhood network cannot vote twice or flood the queue; the keyed hash
-- cannot be enumerated back to an address from the table alone.
-- Additive only (new tables), so the previous release still runs against this schema.
-- Rollback: DROP TABLE printable_request_votes; DROP TABLE printable_requests;
--   DELETE FROM schema_migrations WHERE name = '046_printable_requests.sql'.
CREATE TABLE printable_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_topic text NOT NULL CHECK (char_length(category_topic) BETWEEN 1 AND 60),
  age_topic      text NOT NULL CHECK (char_length(age_topic) BETWEEN 1 AND 30),
  request_text   text NOT NULL CHECK (char_length(request_text) BETWEEN 1 AND 280),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'created')),
  created_url    text CHECK (created_url IS NULL OR (char_length(created_url) BETWEEN 1 AND 300 AND created_url LIKE '/%' AND created_url NOT LIKE '//%' AND created_url NOT LIKE '%\\%')),
  me_too_count   integer NOT NULL DEFAULT 0 CHECK (me_too_count >= 0),
  submitter_hash text NOT NULL CHECK (char_length(submitter_hash) = 64),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at    timestamptz,
  CHECK (status <> 'created' OR created_url IS NOT NULL)
);
CREATE INDEX printable_requests_public_idx ON printable_requests (status, me_too_count DESC, created_at DESC);
CREATE INDEX printable_requests_queue_idx ON printable_requests (status, created_at);

-- One me-too vote per visitor per request. The primary key IS the dedupe: a second vote from the same
-- visitor hash inserts nothing, and the count only moves when a row lands.
CREATE TABLE printable_request_votes (
  request_id uuid NOT NULL REFERENCES printable_requests (id) ON DELETE CASCADE,
  voter_hash text NOT NULL CHECK (char_length(voter_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, voter_hash)
);
