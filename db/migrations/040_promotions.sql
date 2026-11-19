-- Promotions framework (owner direction, 19 November 2026). A promotion is DATA, not code: a row the owner can
-- create, edit, activate and end from /admin without a deployment. The `type` names the mechanic; type-specific
-- settings live in `config` (jsonb) so a future type plugs in without a schema change. Additive only (new tables),
-- so the previous release still runs against this schema.
CREATE TABLE promotions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,80}$'),
  type              text NOT NULL CHECK (char_length(type) BETWEEN 1 AND 40),
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  short_description text NOT NULL CHECK (char_length(short_description) BETWEEN 1 AND 300),
  body              text NOT NULL DEFAULT '' CHECK (char_length(body) <= 8000),
  rules             text NOT NULL DEFAULT '' CHECK (char_length(rules) <= 12000),
  prize             text NOT NULL DEFAULT '' CHECK (char_length(prize) <= 300),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'ended')),
  starts_on         date,
  ends_on           date,
  config            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX promotions_live_idx ON promotions (status, starts_on, ends_on);

-- One entry per account per promotion. Entry is the account holder's own opt-in; for a draw type the row also
-- records that they attested they are 18 or over at entry time. Child profiles never hold entries (no profile id
-- is stored here at all: entries belong to accounts, and the entry route requires the adult account context).
CREATE TABLE promo_entries (
  promotion_id    uuid NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  attested_adult  boolean NOT NULL DEFAULT false,
  entered_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (promotion_id, account_id)
);

-- A recorded draw: the entrant pool it drew from, the seed that drove it and the winners it produced, so anyone
-- with the seed and the pool can recompute the same winners (lib/promos/draw.ts names the method). One draw per
-- promotion per month; a month that has been drawn is never redrawn.
CREATE TABLE promo_draws (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
  month        text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  pool_size    int  NOT NULL CHECK (pool_size >= 0),
  seed         text NOT NULL,
  method       text NOT NULL,
  winners      jsonb NOT NULL DEFAULT '[]'::jsonb,
  drawn_by     text NOT NULL,
  drawn_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, month)
);

-- The first promotion (owner-approved design, 19 November 2026): the 10-Day Spark Streak, a `streak_draw`.
-- Seeded live: staging verifies the real thing, and the production deploy makes it live there as part of the
-- verified ship. ON CONFLICT keeps any later admin edits (this migration runs once, but the guard costs nothing).
INSERT INTO promotions (slug, type, title, short_description, body, rules, prize, status, starts_on, ends_on, config)
VALUES (
  'spark-streak',
  'streak_draw',
  'The 10-Day Spark Streak',
  'Answer the Question of the Day, ten days in a row. Finish the streak and you are in the monthly draw for a $25 gift card — five winners every month.',
  'Here is how it works.

Every day there is one Question of the Day on SparkKindly. Answer it correctly and your streak grows by one. Answer it correctly ten days in a row and you have completed the streak.

Life happens, so every attempt includes one streak-freeze: miss a single day and the freeze covers it, once. Miss two days in a row and the streak starts again — no hard feelings, just start a new one.

Enter the draw once (it is free, and you only enter once) and every month you complete the streak, you are in that month''s drawing. Spark picks five winners at random from that month''s finishers, and each winner gets a $25 gift card.

You need a free SparkKindly account so we can keep your streak honestly — your answers are saved to your account as you play. Spark is cheering for you.',
  'The official rules, in plain words.

1. It is free. Entering the 10-Day Spark Streak costs nothing, and you never have to buy anything.
2. You need a free SparkKindly account. Your streak is counted from the answers saved to your account, so play while signed in.
3. What counts: a correct answer to the Question of the Day — the daily question shown on the home page and at /quiz/ — on that day. Answers to other questions, and answers given on a different day, do not count toward a streak.
4. A completed streak is 10 days in a row with a correct daily answer. Each attempt includes one streak-freeze, which forgives one missed day. A second missed day in a row ends the attempt.
5. The draw: every month, SparkKindly draws 5 winners at random from the people who entered and completed the streak that month. Each winner receives a $25 gift card (sent by email). The total prize each month is $125.
6. The draw is for grown-ups: you must be 18 or older to enter it. Anyone of any age can play, build a streak and complete it — younger players just cannot enter the prize draw. A child profile can never enter.
7. One entry per person and per account. Entering more than once, or with more than one account, can remove you from the draw.
8. Winners are told at the email address on their SparkKindly account. A winner must reply within 14 days of that email, or the prize may go to another finisher drawn the same way.
9. SparkKindly may check streaks against its saved answer records before awarding a prize, and may end or change the promotion at any time; any month already completed will still be drawn.
10. Gift cards are sent by email after winners confirm. There is no cash alternative.',
  'Five $25 gift cards drawn every month',
  'live',
  '2026-11-19',
  NULL,
  '{"targetDays": 10, "freezeAllowance": 1, "winnersPerDraw": 5}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;
