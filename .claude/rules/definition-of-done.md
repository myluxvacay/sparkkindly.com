# Definition of Done

Apply the task tier in `AGENTS.md`; this checklist does not add review rounds.

- Requested outcome and acceptance criteria met; scope respected.
- Applicable verification passes, with actual results and any limits reported.
- Required review findings resolved; High-risk changes independently reviewed before merge.
- Relevant security, data-isolation, child-safety, accessibility, privacy (no third-party requests, no trackers)
  and operational invariants (MyLuxVacation untouched, firewall unchanged) preserved.
- Changed user/developer/operational behavior documented where needed (`docs/OPERATIONS.md` for operations).
- Final diff inspected for unintended changes and sensitive/generated files.

Read-only work needs findings and evidence, not an implementation checklist.
Trivial prose/policy edits need relevant document checks, not application tests.
For UI behavior changes, verify representative affected states visually and with appropriate accessibility checks.
Use existing fixtures; add data only when necessary to exercise a changed state.
A comprehensive test run happens only when the owner asks for one; release readiness applies at its own gate, as defined in AGENTS.md.
