-- How Things Work printables category (owner direction, 23 November 2026): six owner-delivered
-- explainer posters join the Printables library under their own category topic, parented under the
-- printables collection exactly like the fifteen activity categories migration 045 seeded. The
-- legacy import links an article's tags to topics by slug and silently drops any tag with no topic
-- row, so this row makes the posters browsable on the /printables/ hub and findable through the
-- search page's Printables filter. db/seed/topics.ts carries the same row for fresh databases.
-- Expand only: inserted idempotently so a row an owner already created or renamed in /admin is
-- left as it is. The previous release ignores the new row.
-- Rollback: DELETE FROM item_topics WHERE topic_id IN (SELECT id FROM topics WHERE slug =
--   'printables-how-things-work'); then DELETE FROM topics WHERE slug =
--   'printables-how-things-work'; DELETE FROM schema_migrations WHERE name =
--   '048_how_things_work_topic.sql'.
INSERT INTO topics (slug, name, parent_id)
SELECT 'printables-how-things-work', 'How Things Work', (SELECT id FROM topics WHERE slug = 'printables')
ON CONFLICT (slug) DO NOTHING;
