-- Report-a-Mistake (owner direction, 23 November 2026): the reader problem reports grow the review
-- lifecycle the owner asked for — pending → fixed / not-a-mistake / duplicate — and two new issue
-- types (typo, picture mismatch) join the original four. Existing rows map onto the new vocabulary:
-- open → pending (still awaiting review), closed → fixed (the old queue's only outcome was a fix or
-- a dismissal; 'fixed' is the honest default for a closed report). The reports review queue lives
-- beside Request-a-Creation in /admin/requests/; reports are never shown publicly.
-- Rollback: map statuses back (pending → open, anything else → closed), restore the two CHECKs and
--   the 'open' default; DELETE FROM schema_migrations WHERE name = '047_report_lifecycle.sql'.
ALTER TABLE problem_reports DROP CONSTRAINT problem_reports_reason_check;
ALTER TABLE problem_reports ADD CONSTRAINT problem_reports_reason_check
  CHECK (reason IN ('wrong', 'unsafe', 'broken', 'other', 'typo', 'picture'));
UPDATE problem_reports SET status = 'pending' WHERE status = 'open';
UPDATE problem_reports SET status = 'fixed' WHERE status = 'closed';
ALTER TABLE problem_reports DROP CONSTRAINT problem_reports_status_check;
ALTER TABLE problem_reports ADD CONSTRAINT problem_reports_status_check
  CHECK (status IN ('pending', 'fixed', 'not-a-mistake', 'duplicate'));
ALTER TABLE problem_reports ALTER COLUMN status SET DEFAULT 'pending';
