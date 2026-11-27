-- Family Hub — chore schedules (owner direction, 27 November 2026): chores gain real
-- recurring schedules. Phase 2 cadences were daily | weekly | one_off; a chore can now be
-- due on specific weekdays.
--
-- schedule_days is a weekday bitmask: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64.
-- It is set exactly when cadence = 'specific_days' and NULL for every other cadence — the
-- consistency CHECK below keeps the two from ever disagreeing, so due-day logic never has
-- to guess which field wins. Existing rows are untouched: their cadence is one of the old
-- three and schedule_days stays NULL, which the CHECK accepts.
--
-- A specific-days chore completes once per due day: its completion period_key is the
-- circle-local date, the same uniqueness pattern a daily chore already uses
-- (UNIQUE (chore_id, period_key) from 051), so no completion-table change is needed.
-- The cadence CHECK is widened by replacing it inside one statement, per the repo's
-- expand-then-contract migration rule (tests/unit/migrate-files.test.ts).
-- Rollback: reverse the cadence widening the same way (replace hub_chores_cadence_check
--   with the original three-value CHECK), remove the consistency constraint and the
--   schedule_days column, and delete this file's schema_migrations row.

ALTER TABLE hub_chores
  ADD COLUMN schedule_days integer CHECK (schedule_days IS NULL OR schedule_days BETWEEN 1 AND 127);

ALTER TABLE hub_chores
  DROP CONSTRAINT hub_chores_cadence_check,
  ADD CONSTRAINT hub_chores_cadence_check CHECK (cadence IN ('daily', 'weekly', 'one_off', 'specific_days'));

ALTER TABLE hub_chores
  ADD CONSTRAINT hub_chores_cadence_days_check
  CHECK ((cadence = 'specific_days') = (schedule_days IS NOT NULL));
