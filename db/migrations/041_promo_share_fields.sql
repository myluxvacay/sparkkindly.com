-- Per-promo share/SEO fields (owner direction, 19 November 2026): a promotion's page renders its meta —
-- title, description, Open Graph and Twitter card — from its record, so the owner can tune how a promo
-- looks when its link is shared without a deployment. All nullable: an unset field falls back to the
-- promo's title / short description and the promotions hub's share image. Additive only.
ALTER TABLE promotions
  ADD COLUMN share_title text CHECK (share_title IS NULL OR char_length(share_title) BETWEEN 1 AND 120),
  ADD COLUMN share_description text CHECK (share_description IS NULL OR char_length(share_description) BETWEEN 1 AND 300),
  ADD COLUMN share_image text CHECK (share_image IS NULL OR char_length(share_image) BETWEEN 1 AND 300);

-- The Spark Streak's share card: branded 1200x630 art served by the site (public/images/promos/).
UPDATE promotions
SET share_title = 'The 10-Day Spark Streak — 5 × $25 gift cards every month',
    share_description = 'Answer the Question of the Day correctly, ten days in a row, and you are in the monthly draw. Free to enter — the prize draw is for grown-ups (18+).',
    share_image = '/images/promos/share-streak.jpg'
WHERE slug = 'spark-streak';
