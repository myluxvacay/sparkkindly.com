# Architecture decision records

One record per material decision, using `.claude/templates/adr.md`. A record is never edited to say something
different; it is superseded by a new one that links back. The design spec's section 8 lists every design call made
during the 30 October 2026 review; the ones below are the material architecture decisions among them. Later
decisions get their own records as they are made.

| ADR | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-postgresql-over-mongodb.md) | PostgreSQL replaces MongoDB as SparkKindly's database | Accepted | 2026-10-30 |
| [0002](0002-systemd-releases-not-docker.md) | Plain systemd services with release directories, not Docker | Accepted | 2026-10-30 |
| [0003](0003-content-agents-on-owner-machine.md) | Content agents run as scheduled Claude Code tasks on the owner's machine | Accepted | 2026-10-30 |
