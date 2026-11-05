-- Social distribution, text and image posts (Project 5A). Expand only: three new tables and a wider agents.role CHECK
-- (the promotion agent's key, role 'promoter', accepted only by /api/agent/promotions/*). The previous release ignores
-- the tables and refuses a promoter key on every route (its routes accept only content, moderation or reviewer).
-- social_platforms: per-platform switch (all off), daily cap (0 to 10) and posting time (UTC), set in /admin/social/.
-- distributions: one row per item and platform, ever; status moves only through lib/social/states.ts.
-- social_visits: aggregate landings from a social link per day, platform and item. No identifier of any kind.
-- Rollback (before deploying the previous release): UPDATE agents SET enabled = false WHERE role = 'promoter';
-- then, only to remove everything: DROP TABLE social_visits, distributions, social_platforms;
-- DELETE FROM agents WHERE role = 'promoter';
-- ALTER TABLE agents DROP CONSTRAINT agents_role_check,
--   ADD CONSTRAINT agents_role_check CHECK (role IN ('content', 'moderation', 'reviewer'));
-- DELETE FROM schema_migrations WHERE name = '028_social.sql'.
ALTER TABLE agents DROP CONSTRAINT agents_role_check,
  ADD CONSTRAINT agents_role_check CHECK (role IN ('content', 'moderation', 'reviewer', 'promoter'));

CREATE TABLE social_platforms (
  platform      text PRIMARY KEY CHECK (platform IN ('instagram', 'facebook', 'tiktok', 'youtube')),
  enabled       boolean NOT NULL DEFAULT false,
  daily_cap     int NOT NULL CHECK (daily_cap BETWEEN 0 AND 10),
  post_time_utc time NOT NULL DEFAULT '12:00',
  updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO social_platforms (platform, daily_cap, post_time_utc) VALUES
  ('instagram', 2, '12:00'), ('facebook', 3, '13:00'), ('tiktok', 1, '15:00'), ('youtube', 1, '16:00');

CREATE TABLE distributions (
  id            bigserial PRIMARY KEY,
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  platform      text NOT NULL REFERENCES social_platforms (platform),
  day           date NOT NULL,
  status        text NOT NULL CHECK (status IN (
                  'selected', 'skipped', 'copy_ready', 'scheduled', 'posting', 'posted', 'failed', 'cancelled', 'flagged')),
  skip_reason   text CHECK (skip_reason IN ('cap_reached', 'world_rotation', 'not_playable', 'lower_topic_popularity')),
  caption       text,
  hashtags      jsonb NOT NULL DEFAULT '[]',
  link          text,
  image_url     text,
  scheduled_for timestamptz,
  posted_at     timestamptz,
  post_url      text,
  external_id   text,
  metrics       jsonb,
  metrics_at    timestamptz,
  attempts      int NOT NULL DEFAULT 0,
  last_error    text,
  version       int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, platform),
  CHECK ((status = 'skipped') = (skip_reason IS NOT NULL))
);
CREATE INDEX distributions_due ON distributions (status, scheduled_for);
CREATE INDEX distributions_platform_day ON distributions (platform, day);

CREATE TABLE social_visits (
  day      date NOT NULL,
  platform text NOT NULL CHECK (platform IN ('instagram', 'facebook', 'tiktok', 'youtube')),
  item_id  uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  visits   int NOT NULL DEFAULT 0,
  PRIMARY KEY (day, platform, item_id)
);
