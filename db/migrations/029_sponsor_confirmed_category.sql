-- Sponsorship review hardening (Project 6 review): a sponsor confirmed by the owner always has a category, so no request
-- or direct write can mark a sponsor shown without one. Expand only: createSponsor already writes both together, and
-- rows from before 025 have neither. The previous release is unaffected.
-- Rollback: ALTER TABLE sponsors DROP CONSTRAINT sponsors_confirmed_category_check;
-- DELETE FROM schema_migrations WHERE name = '029_sponsor_confirmed_category.sql'.
ALTER TABLE sponsors ADD CONSTRAINT sponsors_confirmed_category_check CHECK (confirmed_at IS NULL OR category IS NOT NULL);
