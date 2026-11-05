-- Comments (Project 7A): comments on published items outside Kids, each account's comment trust, and the owner's
-- per-world and per-item switches. Expand only: new tables and defaulted/nullable columns the previous release ignores.
-- worlds.comments_enabled is on by default and off for Kids; the code refuses Kids-world and audience=kids items
-- whatever this says (plan 7A ruling). items.comments_enabled NULL inherits the world's switch.
-- An account's deletion cascades its trust row and its comments, and with them every reply under those comments.
-- Rollback: DROP TABLE comments; DROP TABLE account_trust; ALTER TABLE items DROP COLUMN comments_enabled;
-- ALTER TABLE worlds DROP COLUMN comments_enabled; DELETE FROM schema_migrations WHERE name = '021_comments.sql'.
ALTER TABLE worlds ADD COLUMN comments_enabled boolean NOT NULL DEFAULT true;
UPDATE worlds SET comments_enabled = false WHERE slug = 'kids';
ALTER TABLE items ADD COLUMN comments_enabled boolean;

CREATE TABLE account_trust (
  account_id             uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  level                  int NOT NULL DEFAULT 0 CHECK (level IN (0, 1)),
  approved               int NOT NULL DEFAULT 0 CHECK (approved >= 0),
  rejected               int NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  banned                 boolean NOT NULL DEFAULT false,
  display_name           text CHECK (char_length(display_name) BETWEEN 1 AND 30),
  guidelines_accepted_at timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- moderation_reason: the moderation agent's private reason (7B emails it to the author); never shown on a page.
CREATE TABLE comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id           uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  account_id        uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  parent_id         uuid REFERENCES comments (id) ON DELETE CASCADE,
  body              text NOT NULL CHECK (char_length(body) <= 1000),
  status            text NOT NULL CHECK (status IN ('held', 'published', 'hidden', 'rejected', 'deleted')),
  moderation_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'deleted') = (body = ''))
);

CREATE INDEX comments_item_idx ON comments (item_id, created_at);
CREATE INDEX comments_account_idx ON comments (account_id, created_at);
CREATE INDEX comments_parent_idx ON comments (parent_id);
