-- Report-a-Mistake (owner direction, 23 November 2026): the reader problem reports grow the review
-- lifecycle the owner asked for — pending → fixed / not-a-mistake / duplicate — and two new issue
-- types (typo, picture mismatch) join the original four. Existing rows map onto the new vocabulary:
-- open → pending (still awaiting review), closed → fixed (the old queue's only outcome was a fix or
-- a dismissal; 'fixed' is the honest default for a closed report). The reports review queue lives
-- beside Request-a-Creation in /admin/requests/; reports are never shown publicly.
-- Rollback (LOSSY — read first): the forward closed → fixed mapping already merges the old
--   fix/dismiss distinction, and rows carrying the new 'typo'/'picture' reasons cannot satisfy the
--   old reason CHECK. A rollback must first remap or remove such rows (UPDATE problem_reports SET
--   reason = 'other' WHERE reason IN ('typo', 'picture')), then map statuses back (pending → open,
--   anything else → closed), restore the two CHECKs and the 'open' default, and delete the
--   schema_migrations row for this file.
-- Each CHECK is replaced inside a single statement (drop + re-add of the same *_check name), the
-- shape the expand-then-contract rule allows: no data is dropped, the constraint only widens.
ALTER TABLE problem_reports
  DROP CONSTRAINT problem_reports_reason_check,
  ADD CONSTRAINT problem_reports_reason_check
    CHECK (reason IN ('wrong', 'unsafe', 'broken', 'other', 'typo', 'picture'));
UPDATE problem_reports SET status = 'pending' WHERE status = 'open';
UPDATE problem_reports SET status = 'fixed' WHERE status = 'closed';
ALTER TABLE problem_reports
  DROP CONSTRAINT problem_reports_status_check,
  ADD CONSTRAINT problem_reports_status_check
    CHECK (status IN ('pending', 'fixed', 'not-a-mistake', 'duplicate'));
ALTER TABLE problem_reports ALTER COLUMN status SET DEFAULT 'pending';
