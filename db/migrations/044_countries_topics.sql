-- Country Facts topics (owner direction, 21 November 2026): the Country Facts batch tags its
-- articles with structural tags — the collection (countries), the six continent groupings
-- (africa, asia, europe, north-america, south-america, oceania) and the reading bands
-- (already created by 043). The legacy import links an article's tags to topics by slug and
-- silently drops any tag with no topic row, so these rows make the batch browsable as a
-- collection and visible to the read-next selection, which ranks by shared topics.
-- Continents are parented under the countries collection topic.
-- Expand only: inserted idempotently so rows an owner already created or renamed in /admin
-- are left as they are. The previous release ignores the new rows.
-- Rollback: DELETE FROM item_topics WHERE topic_id IN (SELECT id FROM topics WHERE slug IN
--   ('countries','africa','asia','europe','north-america','south-america','oceania'));
--   then DELETE FROM topics WHERE slug IN (same list);
--   DELETE FROM schema_migrations WHERE name = '044_countries_topics.sql'.
INSERT INTO topics (slug, name, parent_id) VALUES
  ('countries', 'Countries', NULL)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO topics (slug, name, parent_id)
SELECT v.slug, v.name, (SELECT id FROM topics WHERE slug = 'countries')
FROM (VALUES ('africa', 'Africa'), ('asia', 'Asia'), ('europe', 'Europe'),
             ('north-america', 'North America'), ('south-america', 'South America'),
             ('oceania', 'Oceania')) AS v(slug, name)
ON CONFLICT (slug) DO NOTHING;
