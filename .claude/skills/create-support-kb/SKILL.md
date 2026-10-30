---
name: create-support-kb
description: "Use when a change produces a user-visible symptom that the owner will field, to write a symptom-titled KB article with diagnostics, resolution, workaround and escalation criteria."
---

Follow `AGENTS.md` for task scope and review depth. Use this procedure only when its subject is
part of the requested change or applicable gate; it does not create an extra review round.

# Skill: Create Support KB

Title by symptom. Use `.claude/templates/support-kb.md`; save under `docs/kb/`.

Include:
symptom
affected users/components
likely cause
diagnostics
resolution
workaround
escalation criteria
information to collect
safe logs/metrics
related test case/flow/ADR
version/date

Do not expose secrets or exploit details to end users.
