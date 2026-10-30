---
name: deployment-readiness
description: "Use immediately before a cut-over or a risky deploy to produce the release verdict — configuration parity, migrations, contracts, evidence, server state, observability and runbooks — returning READY, READY-WITH-WARNINGS or BLOCKED."
---

Follow `AGENTS.md` for task scope and review depth. Use this procedure only when its subject is
part of the requested change or applicable gate; it does not create an extra review round.

# Skill: Deployment Readiness

Routine pushes to `main` are gated by CI and the deploy's health check; this skill is for cut-overs, migrations
with data impact, and anything the owner asks to gate.

Determine change set.
Verify configuration parity (env keys on staging and prod).
Verify migrations and rollback.
Verify contracts (agent API, item format).
Verify build/test/security/a11y/data-isolation evidence.
Verify server state and health dependencies (services, disk, swap, latest backup, heartbeats).
Verify observability (monitors, digest).
Verify `docs/OPERATIONS.md` and runbooks.
Return READY / READY-WITH-WARNINGS / BLOCKED using `.claude/templates/deployment-readiness.md`.
