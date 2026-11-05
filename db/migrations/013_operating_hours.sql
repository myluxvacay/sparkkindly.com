-- Owner's weekly operating hours for the pilot (roadmap P.2, spec 4a.2): one row per week, keyed by its Monday.
-- Expand only: a new table the previous release never reads.
-- Rollback: DROP TABLE operating_hours; DELETE FROM schema_migrations WHERE name = '013_operating_hours.sql'.
CREATE TABLE operating_hours (
  week_start date PRIMARY KEY,
  hours      numeric(4,1) NOT NULL CHECK (hours >= 0 AND hours <= 80),
  note       text CHECK (char_length(note) <= 200),
  logged_at  timestamptz NOT NULL DEFAULT now()
);
