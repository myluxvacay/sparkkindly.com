-- Printables topics (owner direction, 22 November 2026): the delivered Printables library tags its
-- articles with structural tags — the collection (printables), the fifteen category groupings and
-- the two delivered age bands (5-8 and 6-10). The legacy import links an article's tags to topics
-- by slug and silently drops any tag with no topic row, so these rows make the library browsable on
-- the /printables/ hub (which filters on topics alone) and findable through the search page's
-- Printables filter. Categories and age bands are parented under the printables collection topic.
-- db/seed/topics.ts carries the same rows for fresh databases.
-- Expand only: inserted idempotently so rows an owner already created or renamed in /admin
-- are left as they are. The previous release ignores the new rows.
-- Rollback: DELETE FROM item_topics WHERE topic_id IN (SELECT id FROM topics WHERE slug IN
--   ('printables','printables-colouring','printables-writing-tracing','printables-counting-maths',
--    'printables-maths','printables-fold-make','printables-mazes','printables-dot-to-dot',
--    'printables-matching-sorting','printables-word-play','printables-reading-aids',
--    'printables-crosswords','printables-cut-paste-crafts','printables-kindness-feelings',
--    'printables-science-labels','printables-story-sequencing','ages-5-8','ages-6-10'));
--   then DELETE FROM topics WHERE slug IN (same list);
--   DELETE FROM schema_migrations WHERE name = '045_printables_topics.sql'.
INSERT INTO topics (slug, name, parent_id) VALUES
  ('printables', 'Printables', NULL)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO topics (slug, name, parent_id)
SELECT v.slug, v.name, (SELECT id FROM topics WHERE slug = 'printables')
FROM (VALUES ('printables-colouring', 'Coloring Pages'),
             ('printables-writing-tracing', 'Writing & Tracing'),
             ('printables-counting-maths', 'Counting'),
             ('printables-maths', 'Math'),
             ('printables-fold-make', 'Fold & Make'),
             ('printables-mazes', 'Mazes'),
             ('printables-dot-to-dot', 'Dot-to-Dot'),
             ('printables-matching-sorting', 'Matching & Sorting'),
             ('printables-word-play', 'Word Play'),
             ('printables-reading-aids', 'Reading Aids'),
             ('printables-crosswords', 'Crosswords'),
             ('printables-cut-paste-crafts', 'Cut-and-Paste Crafts'),
             ('printables-kindness-feelings', 'Kindness & Feelings'),
             ('printables-science-labels', 'Label-the-Parts'),
             ('printables-story-sequencing', 'Story Sequencing Cards'),
             ('ages-5-8', 'Ages 5–8'),
             ('ages-6-10', 'Ages 6–10')) AS v(slug, name)
ON CONFLICT (slug) DO NOTHING;
