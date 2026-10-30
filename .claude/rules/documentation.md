# Documentation

Update the existing document whose meaning changed; do not create a documentation bundle for every task.
Use an ADR (`docs/adr/`) for a material architecture decision, a threat-model update for changed threats,
a KB for recurring support needs, and `docs/OPERATIONS.md` for changed operational procedure.
Preserve existing REQ/TC/FLOW/KB/ADR/SEC/A11Y IDs and relevant cross-links; do not create IDs just for ceremony.
Title KBs by symptoms and keep sensitive diagnostics out of user-facing material.

Current task status belongs in `docs/superpowers/plans/2026-10-30-roadmap-tracker.md`; the detailed plan for the
project in progress lives beside it. Historical evidence stays in the linked plan or in `docs/OPERATIONS.md`.
Keep task entries short. Link to test/review evidence instead of copying long logs or retelling every review round.

The design spec (`docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md`) is the approved requirement.
Changing what it says is an owner decision, recorded in the spec with the date; a plan never silently departs from it.
