-- Core schema for the SparkKindly platform (Project 1). Applied once by db/migrate.mjs.
-- Expand-then-contract: later migrations add; nothing here is ever dropped by a release that still needs it.

CREATE TABLE worlds (
  id            serial PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  promise       text,
  description   text,
  icon          text,
  color         text,
  sort          int  NOT NULL DEFAULT 0,
  enabled       boolean NOT NULL DEFAULT true,
  approval_mode text NOT NULL DEFAULT 'auto' CHECK (approval_mode IN ('auto', 'review')),
  buffer_days   int  NOT NULL DEFAULT 3 CHECK (buffer_days >= 0),
  goals         text
);

CREATE TABLE topics (
  id        serial PRIMARY KEY,
  slug      text NOT NULL UNIQUE,
  name      text NOT NULL,
  parent_id int REFERENCES topics (id)
);

CREATE TABLE agents (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  world_id    int REFERENCES worlds (id),   -- NULL = the master agent, which names the world per request
  key_prefix  text NOT NULL UNIQUE,
  key_hash    text NOT NULL,                -- sha256 of the secret part; the key itself is never stored
  enabled     boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        int  NOT NULL REFERENCES worlds (id),
  kind            text NOT NULL CHECK (kind IN ('article', 'game', 'quiz', 'video_script', 'puzzle')),
  slug            text NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  locale          text NOT NULL DEFAULT 'en',
  title           text NOT NULL,
  summary         text NOT NULL,
  body            jsonb NOT NULL,
  audience        text NOT NULL CHECK (audience IN ('kids', 'all', 'adults')),
  evergreen       boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'in_review', 'scheduled', 'published', 'rejected', 'archived')),
  publish_at      timestamptz,
  published_at    timestamptz,
  created_by      text NOT NULL,
  agent_id        int REFERENCES agents (id),
  risk_tier       text NOT NULL CHECK (risk_tier IN ('excluded', 'sourced', 'computable', 'reflective', 'kids')),
  sources         jsonb NOT NULL DEFAULT '[]',
  quality_report  jsonb NOT NULL DEFAULT '{}',
  image           jsonb NOT NULL DEFAULT '{}',
  approved_by     text,
  approved_at     timestamptz,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, locale, slug),
  UNIQUE (agent_id, idempotency_key),
  -- Nothing for children goes out unreviewed: this holds even for a direct SQL update.
  CONSTRAINT kids_requires_approval CHECK (
    (risk_tier <> 'kids' AND audience <> 'kids')
    OR status NOT IN ('scheduled', 'published')
    OR approved_by IS NOT NULL
  )
);

CREATE INDEX items_status_publish_at ON items (status, publish_at);
CREATE INDEX items_world_status_published ON items (world_id, status, published_at DESC);
CREATE INDEX items_search ON items USING gin (to_tsvector('english', title || ' ' || summary));

CREATE TABLE item_topics (
  item_id  uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  topic_id int  NOT NULL REFERENCES topics (id),
  PRIMARY KEY (item_id, topic_id)
);
CREATE INDEX item_topics_topic ON item_topics (topic_id);

-- Correct answers live apart from item bodies so no public read can return them by accident.
CREATE TABLE item_answers (
  item_id     uuid PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
  answer      jsonb NOT NULL,
  explanation text NOT NULL
);

CREATE TABLE item_revisions (
  id         bigserial PRIMARY KEY,
  item_id    uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  revision   int  NOT NULL,
  snapshot   jsonb NOT NULL,
  changed_by text NOT NULL,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, revision)
);

-- The site's own analytics: server-side counts, no third-party trackers.
CREATE TABLE events (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  name       text NOT NULL,
  profile_id uuid,
  meta       jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE audit_log (
  id     bigserial PRIMARY KEY,
  at     timestamptz NOT NULL DEFAULT now(),
  actor  text NOT NULL,
  action text NOT NULL,
  target text,
  detail jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE sponsors (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  link        text NOT NULL,
  logo        text,
  disclosure  text NOT NULL,
  active_from date,
  active_to   date
);

CREATE TABLE sponsorships (
  id          serial PRIMARY KEY,
  sponsor_id  int  NOT NULL REFERENCES sponsors (id),
  world_id    int  REFERENCES worlds (id),
  topic_id    int  REFERENCES topics (id),
  item_id     uuid REFERENCES items (id),
  label       text NOT NULL,
  click_count int  NOT NULL DEFAULT 0,
  starts_on   date,
  ends_on     date,
  CHECK (num_nonnulls(world_id, topic_id, item_id) = 1)
);

CREATE TABLE failed_jobs (
  id       bigserial PRIMARY KEY,
  job      text NOT NULL,
  payload  jsonb NOT NULL DEFAULT '{}',
  error    text NOT NULL,
  attempts int  NOT NULL DEFAULT 1,
  at       timestamptz NOT NULL DEFAULT now()
);
