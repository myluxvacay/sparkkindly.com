-- Green topics (owner decision, 7 November 2026): environment education sits under Discover (the why) and Grow (one
-- small step), not in a world of its own. Expand only: four topics under one parent, inserted idempotently so rows an
-- owner already created or renamed in /admin are left as they are. The previous release ignores the new rows.
-- Rollback: DELETE FROM topics WHERE slug IN ('climate','recycling','reducing-waste','energy-saving')
--   AND NOT EXISTS (SELECT 1 FROM item_topics it WHERE it.topic_id = topics.id); then the same for slug = 'green';
-- DELETE FROM schema_migrations WHERE name = '032_green_topics.sql'.
INSERT INTO topics (slug, name, parent_id) VALUES ('green', 'Green', NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO topics (slug, name, parent_id)
SELECT v.slug, v.name, (SELECT id FROM topics WHERE slug = 'green')
FROM (VALUES ('climate', 'Climate'), ('recycling', 'Recycling'), ('reducing-waste', 'Reducing waste'), ('energy-saving', 'Saving energy')) AS v(slug, name)
ON CONFLICT (slug) DO NOTHING;
