# SparkKindly — current status

Orientation for an agent or engineer starting work. Keep this to one screen; details live in the linked documents.

**What this is.** A platform rebuild of https://sparkkindly.com (today a static mock-up) into a database-backed
Next.js site filled daily by Claude Code agents, with personal dashboards, circles, moderated comments, contributors,
social distribution and light sponsorship. First audience: teenagers and young adults (13–25).

**Governing documents, in order.**
1. Owner decisions (recorded in the spec with dates).
2. `AGENTS.md` — task tiers, verification, review, reporting.
3. `.claude/rules/` — always-on rules.
4. `.claude/skills/` — workflows; `.claude/agents/` — specialist roles used only when the tier calls for them.

**Requirements.** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` (approved 30 October 2026).

**Where work stands.** `docs/superpowers/plans/2026-10-30-roadmap-tracker.md` — the task board for every project.
The project in progress has a detailed plan beside it. Current: **Project 0 — Foundations**
(`2026-10-30-project-0-foundations.md`), not yet started.

**Environment.** Hostinger VM `2.25.121.2` (Ubuntu 24.04, Caddy, MongoDB for MyLuxVacation which must not be
touched). Production will run as systemd services on loopback port 3100, staging on 3101, PostgreSQL 16 on loopback.
Operational procedures, once they exist, are in `docs/OPERATIONS.md`.

**Decisions.** `docs/adr/` holds the material architecture decisions; the spec's section 8 lists every design call.
