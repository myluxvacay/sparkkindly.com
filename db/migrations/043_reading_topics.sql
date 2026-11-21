-- Reading-series topics (owner direction, 20 November 2026): the Poster Series pilot and the reading
-- strand tag their articles with structural tags — the collection (reading, poster-series), the five
-- tracks (grammar, phonics, vocabulary, kindness, explainers) and the three reading bands (pre-k,
-- grades-k-2, grades-3-5). The legacy import links an article's tags to topics by slug and silently
-- drops any tag with no topic row, so until now only "kindness" (already a topic) survived the import
-- and the rest of the pilot's structure was invisible to the site — including to the read-next
-- selection, which ranks by shared topics. Kindness already exists and is not repeated here.
-- Expand only: inserted idempotently so rows an owner already created or renamed in /admin are left
-- as they are. The previous release ignores the new rows.
-- Rollback: DELETE FROM item_topics WHERE topic_id IN (SELECT id FROM topics WHERE slug IN
--   ('reading','poster-series','explainers','pre-k','grades-k-2','grades-3-5','grammar','phonics','vocabulary'));
--   then DELETE FROM topics WHERE slug IN (same list);
--   DELETE FROM schema_migrations WHERE name = '043_reading_topics.sql'.
INSERT INTO topics (slug, name, parent_id) VALUES
  ('reading', 'Reading', NULL),
  ('poster-series', 'Poster series', NULL),
  ('explainers', 'Explainers', NULL),
  ('pre-k', 'Pre-K', NULL),
  ('grades-k-2', 'Grades K-2', NULL),
  ('grades-3-5', 'Grades 3-5', NULL)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO topics (slug, name, parent_id)
SELECT v.slug, v.name, (SELECT id FROM topics WHERE slug = 'language')
FROM (VALUES ('grammar', 'Grammar'), ('phonics', 'Phonics'), ('vocabulary', 'Vocabulary')) AS v(slug, name)
ON CONFLICT (slug) DO NOTHING;
