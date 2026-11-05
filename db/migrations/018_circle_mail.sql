-- Circle mail (Project 4D): one row per (circle, kind, period) claimed before the set-ready ('daily', period = the
-- circle's local day), weekly summary ('weekly', period = the local Monday) or re-score notice ('rescore', period = the
-- circle_notices id) emails go out, so a rerun or a second worker never mails a period twice. No address, no account.
-- Rows cascade with their circle.
-- Expand only: a new table the previous release never reads.
-- Rollback: DROP TABLE circle_mail_log; DELETE FROM schema_migrations WHERE name = '018_circle_mail.sql'.
CREATE TABLE circle_mail_log (
  circle_id uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  kind      text NOT NULL CHECK (kind IN ('daily', 'weekly', 'rescore')),
  period    text NOT NULL CHECK (char_length(period) BETWEEN 1 AND 20),
  sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, kind, period)
);
