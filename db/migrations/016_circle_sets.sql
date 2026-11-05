-- Circle interests and daily sets (Project 4C). A circle picks topics and worlds (by id, like profile_interests); each
-- circle day gets up to five playable items, made on first request and then fixed (one row per circle, day and position;
-- an item at most once a day). Rows cascade with their circle, topic, world or item.
-- Expand only: new tables the previous release never reads.
-- Rollback: DROP TABLE circle_daily_sets; DROP TABLE circle_interests;
-- DELETE FROM schema_migrations WHERE name = '016_circle_sets.sql'.
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
