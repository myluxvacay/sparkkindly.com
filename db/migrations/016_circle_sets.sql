-- Circle interests and daily sets (Project 4C). A circle picks topics and worlds (by id, like profile_interests); each
-- circle day gets up to five playable items, made on first request and then fixed (one row per circle, day and position;
-- an item at most once a day). Rows cascade with their circle, topic, world or item.
-- Scores are derived on read (lib/circles/scores.ts); nothing is double-stored. circle_notices records that an item in a
-- circle's recent sets was re-scored after its answer key changed. site_settings holds owner-tuned values
-- (points_correct). item_responses.choice keeps the chosen answer for closed mechanics (an option id, true/false, a
-- number, an order of ids; never free text) so a corrected key can re-score it; older rows stay NULL (not re-scorable).
-- Expand only: new tables and one nullable column the previous release never reads.
-- Rollback: DROP TABLE circle_notices; DROP TABLE circle_daily_sets; DROP TABLE circle_interests; DROP TABLE site_settings;
-- ALTER TABLE item_responses DROP COLUMN choice; DELETE FROM schema_migrations WHERE name = '016_circle_sets.sql'.
CREATE TABLE circle_interests (
  circle_id uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  topic_id  int REFERENCES topics (id) ON DELETE CASCADE,
  world_id  int REFERENCES worlds (id) ON DELETE CASCADE,
  CHECK (num_nonnulls(topic_id, world_id) = 1)
);

CREATE UNIQUE INDEX circle_interests_topic_uq ON circle_interests (circle_id, topic_id) WHERE topic_id IS NOT NULL;
CREATE UNIQUE INDEX circle_interests_world_uq ON circle_interests (circle_id, world_id) WHERE world_id IS NOT NULL;

CREATE TABLE circle_daily_sets (
  circle_id uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  day       date NOT NULL,
  position  int NOT NULL CHECK (position BETWEEN 1 AND 20),
  item_id   uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  bonus     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (circle_id, day, position),
  UNIQUE (circle_id, day, item_id)
);

CREATE INDEX circle_daily_sets_item_idx ON circle_daily_sets (item_id, day);

CREATE TABLE circle_notices (
  id         bigserial PRIMARY KEY,
  circle_id  uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind = 'rescored'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX circle_notices_circle_idx ON circle_notices (circle_id, created_at DESC);

CREATE TABLE site_settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE item_responses ADD COLUMN choice jsonb;

CREATE INDEX item_responses_item_idx ON item_responses (item_id);
