-- Age-band topics (owner decisions, 24 November 2026): every content item is tagged with the
-- age band(s) it suits — canonical child bands 3-5, 6-8, 9-12 (lib/age-bands.ts). Visitors pick
-- a band (never an exact age); serving leads with band-matching items. 'family' (all-ages) is
-- deliberately NOT a topic: it is the absence of a child-band topic. The legacy import and the
-- guarded sync (lib/items/update-age-bands.ts) link these topics from each item's ageBands
-- field; without the topic rows those links would be silently dropped. db/seed/topics.ts
-- carries the same rows for fresh databases.
-- Expand only: inserted idempotently so rows an owner already created or renamed in /admin
-- are left as they are. The previous release ignores the new rows.
-- Rollback: DELETE FROM item_topics WHERE topic_id IN (SELECT id FROM topics WHERE slug IN
--   ('ages-3-5','ages-6-8','ages-9-12')); then DELETE FROM topics WHERE slug IN
--   ('ages-3-5','ages-6-8','ages-9-12','age-bands');
--   DELETE FROM schema_migrations WHERE name = '049_age_band_topics.sql'.
INSERT INTO topics (slug, name, parent_id) VALUES
  ('age-bands', 'Age bands', NULL)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO topics (slug, name, parent_id)
SELECT v.slug, v.name, (SELECT id FROM topics WHERE slug = 'age-bands')
FROM (VALUES ('ages-3-5', 'Ages 3–5'),
             ('ages-6-8', 'Ages 6–8'),
             ('ages-9-12', 'Ages 9–12')) AS v(slug, name)
ON CONFLICT (slug) DO NOTHING;
