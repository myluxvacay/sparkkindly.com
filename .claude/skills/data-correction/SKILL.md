---
name: data-correction
description: "Use before any UPDATE or DELETE against real data. Enforces scope definition, read-only preview, verified backup of the exact scope, transactional execution, invariant verification and a rollback script."
---

Follow `AGENTS.md` for task scope and review depth. Use this procedure only when its subject is
part of the requested change or applicable gate; it does not create an extra review round.

# Skill: Data Correction

High-risk tier. Requires the owner's authorization for the specific correction.

1. Define exact target rows.
2. Produce read-only preview and row count.
3. Create recoverable backup of the exact scope (`pg_dump -t` or scoped `COPY`), on the VM, outside the web root.
4. Verify backup count/content.
5. Execute correction transactionally where feasible.
6. Verify row count and business invariants (tallies, consent states, audience).
7. Provide rollback script/procedure.
8. Preserve backup until the owner confirms.
9. Record audit/change note in `docs/OPERATIONS.md`.
