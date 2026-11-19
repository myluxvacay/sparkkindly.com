# 0005 — Promotions as data, with a typed mechanic registry

**Status:** Accepted · 2026-11-19

## Context

The owner wanted a traffic promotion — a 10-day streak challenge with a monthly prize draw — and promotions
will recur. Building each one as bespoke pages would mean a deployment for every launch, edit and ending,
and would scatter the rules of each mechanic across one-off code. The site already treats library content as
data (records rendered by generic pages, changed without deploys); promotions deserved the same shape.

## Decision

A promotion is a database record (`promotions`, migration 040): slug, title, short description, body,
rules, prize, start/end dates, a status (draft / live / ended) and a `type`. Public pages render records:
`/promos/` lists the live ones and `/promos/<slug>/` renders any live record through a generic shell. The
owner creates, edits, activates and ends promotions in `/admin/promos/` — all data edits, effective at once,
audited like every admin action. A mechanic plugs in through the type registry (`lib/promos/types.ts`): a
type adds its registry entry, its panel on the promo page, its entry handling if it takes entries, and an
admin section if it needs one; the record storage, index and page shell never change. Type-specific settings
ride in the record's `config` jsonb. Unknown types render the generic record with no mechanic and no entries.

The first type is `streak_draw`. Its streaks are derived, never stored: computed from the answers already in
`item_responses` against the designated Question of the Day, so there is no parallel tracking store. A
site-day is the site's own content day — 06:00 UTC to 06:00 UTC, the publish slot — and the designated
question at any moment is the quiz the site itself is showing the answerer then (the latest published quiz
within the answerer's own audiences: a child profile's daily question is never an `adults`-audience quiz,
because they cannot see one; a holder's can, exactly as on their /quiz/ page). An answer counts toward the
site-day it was given in when its item was the designated question at that moment. Streaks count only
site-days from the promotion's own start date. Draw entry is a separate recorded opt-in (`promo_entries`):
account-holder sessions only, the account's own age group must be `adult`, and the entrant attests they are
18+. Monthly winners are picked by a recorded draw (`promo_draws`), run only once the month has ended: the
pool is recomputed from saved answers at draw time, and the row keeps the pool itself (the entrant account
ids), a random seed and the method, so the result stays recomputable from the record alone.

Unlike sibling features, promotions have no opt-in env flag: whether anything is promoted is itself the
data (a record is public only while live), and the surface needs accounts, which are already gated.
`PROMOS_ENABLED=false` remains as an emergency kill switch.

## Consequences

- **Positive.** The owner can run a whole promotion lifecycle from the admin area; the streak mechanic
  inherits the play history's integrity (first answers only, server-derived owner) instead of trusting a
  client-side claim; the draw is auditable after the fact.
- **Negative.** Record text is plain paragraphs — no rich formatting for promo pages. The streak derivation
  re-reads answer history per view; fine at current scale, and a materialised streak table is the known
  escape hatch if entrant counts grow large.
- **Security / Privacy.** Entrant emails are read only behind `requireAdmin`; nothing public lists entrants
  or winners. Child profiles can streak but structurally cannot enter (entries belong to accounts, and the
  entry route refuses a profile session before anything else). The 18+ gate uses the account's recorded
  date-of-birth age group, not the attestation alone.
- **Operational impact.** No new services or secrets. Gift-card fulfilment stays manual (owner emails the
  winners the draw page lists). See `docs/OPERATIONS.md`, "Promotions".
