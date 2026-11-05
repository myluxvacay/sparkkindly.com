-- Child days (4C review M2): the circle days on which a child profile was a member. A set day listed here keeps its
-- `adults` items hidden and scoreless after the child leaves (removal reuses the member row and profile deletion drops
-- it, so the membership row alone cannot tell). Written by a trigger when a current child member row is closed
-- (left_at set) or deleted: every local day from its joined_at to its leaving (or now, for a deletion). While a child is
-- a member the circle's current make-up already filters every day. Rows cascade with their circle.
-- Expand only: a new table and a trigger the previous release never reads (its writes only add rows).
-- Rollback: DROP TRIGGER circle_members_child_days ON circle_members; DROP FUNCTION circle_child_days_mark();
-- DROP TABLE circle_child_days; DELETE FROM schema_migrations WHERE name = '020_circle_child_days.sql'.
CREATE TABLE circle_child_days (
  circle_id uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  day       date NOT NULL,
  PRIMARY KEY (circle_id, day)
);

CREATE FUNCTION circle_child_days_mark() RETURNS trigger AS $$
DECLARE
  zone  text;
  until timestamptz;
BEGIN
  IF OLD.profile_id IS NULL OR OLD.left_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.left_at IS NULL THEN
      RETURN NULL;
    END IF;
    until := NEW.left_at;
  ELSE
    until := now();
  END IF;
  -- No row when the circle itself is being deleted (its member rows cascade): nothing to keep.
  SELECT time_zone INTO zone FROM circles WHERE id = OLD.circle_id;
  IF zone IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO circle_child_days (circle_id, day)
  SELECT OLD.circle_id, d::date
  FROM generate_series((OLD.joined_at AT TIME ZONE zone)::date,
                       greatest((until AT TIME ZONE zone)::date, (OLD.joined_at AT TIME ZONE zone)::date),
                       interval '1 day') AS d
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER circle_members_child_days
  AFTER UPDATE OF left_at OR DELETE ON circle_members
  FOR EACH ROW EXECUTE FUNCTION circle_child_days_mark();
