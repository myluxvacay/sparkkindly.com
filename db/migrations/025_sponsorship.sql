-- Sponsorship (Project 6): additive columns on the Project 1 tables; the previous release ignores them.
-- sponsors.category: one of the allowed categories in lib/sponsorship/rules.ts (the excluded categories of spec 4a.3
-- cannot be stored by any request); NULL only on rows from before this migration, which never render (no confirmation).
-- sponsors.confirmed_at: when the owner ticked "not in an excluded category and not marketed to children"; a sponsor
-- without it is never shown. sponsors.disclosure is no longer written (the disclosure is a fixed template chosen by
-- sponsorships.kind), so it gets an empty default. sponsorships.ended_at: the owner ended it; it never renders again.
-- Rollback: ALTER TABLE sponsorships DROP COLUMN ended_at, DROP COLUMN kind;
-- ALTER TABLE sponsors DROP COLUMN confirmed_at, DROP COLUMN category, ALTER COLUMN disclosure DROP DEFAULT;
-- DELETE FROM schema_migrations WHERE name = '025_sponsorship.sql'.
ALTER TABLE sponsors ADD COLUMN category text CHECK (category IN (
  'education', 'books', 'software', 'services', 'health-and-wellbeing-general', 'finance-education', 'travel', 'food',
  'other-approved'
));
ALTER TABLE sponsors ADD COLUMN confirmed_at timestamptz;
ALTER TABLE sponsors ALTER COLUMN disclosure SET DEFAULT '';
ALTER TABLE sponsorships ADD COLUMN kind text NOT NULL DEFAULT 'supported' CHECK (kind IN ('supported', 'affiliate'));
ALTER TABLE sponsorships ADD COLUMN ended_at timestamptz;
