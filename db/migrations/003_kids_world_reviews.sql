-- The Kids world always stays in review mode. 002 keys the approval rule on a world's approval_mode; this pins that
-- setting for Kids so no admin screen, script or SQL can switch it to auto. Additive: it only adds a constraint.
ALTER TABLE worlds ADD CONSTRAINT kids_world_reviews CHECK (slug <> 'kids' OR approval_mode = 'review');
