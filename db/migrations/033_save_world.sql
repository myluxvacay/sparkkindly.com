-- The Save world (owner decision, 7 November 2026): money-skills guides and quizzes for everyone 13 and over, plus
-- adults-rated offer explainers that may carry an owner-attached affiliate sponsorship. Expand only: one world row
-- (enabled, auto approval, so every item still passes the quality gates and the reviewer) and four money topics,
-- inserted idempotently so rows an owner already created in /admin are left as they are. Save sits after Grow and
-- before Kids: Kids moves from sort 4 to 5 only if it is still at its launch position. The copy matches lib/config.ts.
-- The previous release lists the extra world from the table and needs no code change.
-- Rollback: disable first (UPDATE worlds SET enabled = false WHERE slug = 'save'; this is enough and loses nothing). A
--   full delete cascades: it silently removes members' profile interests and circle interests for the world (010, 016
--   are ON DELETE CASCADE) and fails with a foreign-key error while any agent, sponsorship or contribution references
--   the world or its topics (001, 023). Back up and clear those rows first, and do it only when no item uses it: DELETE FROM worlds WHERE slug = 'save' AND NOT EXISTS (SELECT 1 FROM items i WHERE i.world_id = worlds.id);
--   UPDATE worlds SET sort = 4 WHERE slug = 'kids' AND sort = 5;
--   DELETE FROM topics WHERE slug IN ('budgeting','student-money','money-basics','understanding-offers')
--   AND NOT EXISTS (SELECT 1 FROM item_topics it WHERE it.topic_id = topics.id);
--   DELETE FROM schema_migrations WHERE name = '033_save_world.sql'.
INSERT INTO worlds (slug, name, promise, description, icon, color, sort, approval_mode, comments_enabled)
VALUES ('save', 'Save', 'Spend smart. Keep more.',
        'Everyday money skills for everyone 13 and over: budgeting, saving and reading an offer before you sign up.',
        '◇', 'sky', 4, 'auto', true)
ON CONFLICT (slug) DO NOTHING;
UPDATE worlds SET sort = 5 WHERE slug = 'kids' AND sort = 4;
INSERT INTO topics (slug, name, parent_id) VALUES ('money-habits', 'Money habits', NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO topics (slug, name, parent_id)
SELECT v.slug, v.name, (SELECT id FROM topics WHERE slug = 'money-habits')
FROM (VALUES ('budgeting', 'Budgeting'), ('student-money', 'Student money'), ('money-basics', 'Money basics'),
             ('understanding-offers', 'Understanding offers')) AS v(slug, name)
ON CONFLICT (slug) DO NOTHING;
