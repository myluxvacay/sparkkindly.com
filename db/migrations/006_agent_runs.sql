-- One row per master-agent run (Project 2): which worlds it covered, how many items it produced, whether it stopped on the
-- plan's rate limit. The latest ended_at is the heartbeat the worker checks. Counts and a short note only, never item
-- bodies or keys. Additive: a new table, nothing else changes.
-- Rollback: DROP TABLE agent_runs; DELETE FROM schema_migrations WHERE name = '006_agent_runs.sql'.
CREATE TABLE agent_runs (
  id              bigserial PRIMARY KEY,
  agent_id        int  NOT NULL REFERENCES agents (id),
  worlds          text[] NOT NULL CHECK (cardinality(worlds) > 0),
  started_at      timestamptz NOT NULL,
  ended_at        timestamptz NOT NULL CHECK (ended_at >= started_at),
  items_submitted int  NOT NULL CHECK (items_submitted >= 0),
  items_scheduled int  NOT NULL CHECK (items_scheduled >= 0),
  items_in_review int  NOT NULL CHECK (items_in_review >= 0),
  items_rejected  int  NOT NULL CHECK (items_rejected >= 0),
  rate_limited    boolean NOT NULL DEFAULT false,
  note            text CHECK (char_length(note) <= 300),
  recorded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_runs_ended_at_idx ON agent_runs (ended_at DESC);
