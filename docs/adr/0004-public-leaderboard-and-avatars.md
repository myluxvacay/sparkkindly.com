# 0004 — A public, opt-in leaderboard with chosen avatars

**Status:** Accepted · 2026-11-15

## Context

The 30 October 2026 design review decided leaderboards would be visible only inside a circle, with no public
individual rankings (spec Project 4, "Leaderboards"; section 8, decision 10; roadmap 4.5) and no avatars in
comment threads, to keep children's activity private to their family and avoid pressure mechanics. On
15 November 2026 the owner directed the opposite for the public site: add a public leaderboard, avatar images
and a way to invite leaders into a circle. The owner is the authority over the spec; this record supersedes
the public half of that earlier call while keeping its child-privacy intent through narrower guardrails.

## Decision

SparkKindly gains a public leaderboard at `/leaderboard/`, behind `LEADERBOARD_ENABLED`, listing only account
holders who opt in. Eligibility is a new account-policy capability, `public_leaderboard`, held by the 16–17
and adult age groups only; 13–15 accounts and child profiles can never appear. Points derive from the holder's
own saved answers (`item_responses` with `profile_id` NULL), excluding Kids-world items, at the same
`points_correct` value circles use. Each participant chooses a public display name (blocked-words checked)
and an avatar from a built-in illustrated set; there are no photo uploads and no other personal data is
shown. In-circle leaderboards are unchanged, and the comments rule (no avatars in comment threads) is
unchanged. From the board, a signed-in member can send an account-addressed circle invite (a third
`circle_invites` kind beside link and email), which the invited member accepts or ignores from their
dashboard; no email address is exposed at any point.

## Consequences

- **Positive.** The growth and recognition the owner wants, with the earlier privacy intent preserved where
  it matters: children and younger teens are structurally absent, not just unlisted.
- **Negative.** A public ranking is a pressure mechanic by nature. The mitigations are opt-in, 16+,
  display-name-only, points without per-answer detail, and leaving at any time by opting out; the ranking
  itself remains for those who choose it.
- **Security / Privacy.** Board queries are audience-safe by construction (opt-in rows only, holder's own
  responses only, Kids world excluded) and the age capability fails closed through `ageGroupFor`.
  Account-addressed invites reveal nothing beyond the public name and avatar the invitee already published.
- **Accessibility.** The board is a list with ranks and names as text; avatars are decorative beside a
  visible name, never the only identifier.
- **Operational impact.** One more feature flag (`LEADERBOARD_ENABLED`); the avatar set is static files under
  `public/avatars/`; no new services.
- **Reversibility.** Turning the flag off hides the route and the settings section; the schema change is
  expand-only with a documented rollback; every opt-in defaults off.
- **Open.** Whether a monthly board joins the all-time board after launch, and whether community circles get
  public boards of their own — both the owner's call, neither blocks this work.
