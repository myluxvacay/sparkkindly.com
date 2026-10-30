---
name: database-change
description: "Develop and verify a schema or migration change with compatibility and rollback checks."
---

# Database Change

Follow the High-risk tier in AGENTS.md.
Review schema, queries, indexes, constraints and compatibility needs; write the migration expand-then-contract.
Test apply and verification plus rollback or forward-recovery against a local or staging database, never production.
Confirm the deploy's `migrate.sh` runs it and that the previous release still starts against the new schema.
Record concise migration evidence. Developing a migration does not authorize applying it to production outside the
deploy pipeline.
