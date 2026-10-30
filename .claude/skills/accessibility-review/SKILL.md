---
name: accessibility-review
description: "Use when a UI change needs a WCAG 2.2 AA review before it can be called done — runs automated checks, then the manual keyboard, semantics, contrast, error, media and reflow passes that automation cannot cover."
---

Follow `AGENTS.md` for task scope and review depth. Use this procedure only when its subject is
part of the requested change or applicable gate; it does not create an extra review round.

# Skill: Accessibility Review

For UI changes:
run the Playwright axe checks on the affected pages
perform keyboard/focus review (including answering a playable item)
inspect semantics/labels/ARIA
review errors/modals/live content
verify contrast/reflow at 320px/touch targets
verify captions/transcripts for media
record manual checks and unresolved issues using `.claude/templates/accessibility-review.md`
