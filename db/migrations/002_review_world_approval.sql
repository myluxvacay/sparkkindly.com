-- A world in review mode (Kids, or any world the owner puts there) never schedules or publishes an item that has
-- not been approved, whatever the item's own audience or risk tier says. 001 guards items that label themselves
-- Kids; this guards the world, so a mislabelled item cannot slip through. Additive: no existing row or rule changes.
CREATE FUNCTION enforce_review_world_approval() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('scheduled', 'published')
     AND NEW.approved_by IS NULL
     AND EXISTS (SELECT 1 FROM worlds w WHERE w.id = NEW.world_id AND w.approval_mode = 'review') THEN
    RAISE EXCEPTION 'kids_requires_approval: this world is in review mode and the item has no approver'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kids_requires_approval';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_review_world_approval
  BEFORE INSERT OR UPDATE OF status, approved_by, world_id ON items
  FOR EACH ROW EXECUTE FUNCTION enforce_review_world_approval();
