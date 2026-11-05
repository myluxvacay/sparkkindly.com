-- Contributors (Project 8): a member's contributor profile and their contributions. Expand only: two new tables the
-- previous release ignores. A contributed item is an ordinary `items` row linked from contributions.item_id (plan 8
-- ruling: the link lives on contributions, not on items, so items never reference accounts); an account's deletion
-- archives its published contributed items first (lib/accounts/delete.ts), deletes the never-published ones, then
-- cascades its profile and contributions here, so no byline remains.
-- content: the contributor's own fields as they typed them (title, summary, sections or question, sources, topics).
-- review_reasons: the reviewer agent's short reasons on a fail; owner_notes: the owner's notes or rejection reason;
-- both are shown to the contributor. publication_mailed_at: the claim for the one publication email.
-- Rollback: DROP TABLE contributions; DROP TABLE contributor_profiles;
-- DELETE FROM schema_migrations WHERE name = '023_contributors.sql'.
CREATE TABLE contributor_profiles (
  account_id        uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  slug              text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]{10}$'),
  display_name      text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 30),
  bio               text CHECK (char_length(bio) BETWEEN 1 AND 140),
  link              text CHECK (char_length(link) BETWEEN 9 AND 200),
  link_approved     boolean NOT NULL DEFAULT false,
  terms_accepted_at timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (link IS NOT NULL OR NOT link_approved)
);

CREATE TABLE contributions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  item_id               uuid UNIQUE REFERENCES items (id) ON DELETE SET NULL,
  state                 text NOT NULL CHECK (state IN ('draft', 'submitted', 'agent_review', 'needs_owner',
                          'changes_requested', 'approved', 'rejected', 'withdrawn')),
  kind                  text NOT NULL CHECK (kind IN ('article', 'quiz')),
  world_id              int NOT NULL REFERENCES worlds (id),
  slug                  text NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,80}$'),
  content               jsonb NOT NULL,
  revision              int NOT NULL DEFAULT 0 CHECK (revision >= 0),
  gate_reasons          jsonb NOT NULL DEFAULT '[]',
  review_reasons        jsonb NOT NULL DEFAULT '[]',
  owner_notes           text CHECK (char_length(owner_notes) BETWEEN 1 AND 500),
  declared_at           timestamptz,
  submitted_at          timestamptz,
  publication_mailed_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contributions_account_idx ON contributions (account_id, created_at);
CREATE INDEX contributions_state_idx ON contributions (state, submitted_at) WHERE state IN ('agent_review', 'needs_owner');
