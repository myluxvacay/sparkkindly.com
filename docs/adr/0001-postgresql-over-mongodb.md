# 0001 — PostgreSQL replaces MongoDB as SparkKindly's database

**Status:** Accepted · 2026-10-30

## Context

The mock-up pulled content from MongoDB on the VM into a JSON snapshot at build time. The platform rebuild adds
accounts, child profiles, circles, memberships, answers, scores, comments, sponsorships and contributor
submissions: data that is relational, with leaderboards and daily-set selection as its hottest queries. The owner
asked whether MongoDB would hold up long-term and said a different database was acceptable if more robust.
MongoDB 8 stays on the VM for MyLuxVacation and must not be disturbed.

## Decision

SparkKindly uses PostgreSQL 16 (Ubuntu's packaged version) on the existing VM, loopback only, with one database per
environment (`sparkkindly`, `sparkkindly_staging`). Flexible item bodies are JSON columns inside relational tables.
SparkKindly stops using MongoDB entirely; nothing migrates from it except the 10 articles and 14 quizzes, which are
imported from the repository's JSON files.

## Consequences

- **Positive.** Joins and aggregates for circles and scores are plain SQL; constraints enforce status transitions
  and audience values at the database; mature backup tooling (`pg_dump`); full-text search without another service.
- **Negative.** Two database engines now run on the VM (MongoDB for the other site); the team must manage
  migrations with discipline (expand-then-contract) because rollback is the previous release directory.
- **Security / Privacy.** Child-profile and consent data sit in the same database as everything else; isolation is
  enforced in queries and tested by the data-isolation matrix, not by separate stores.
- **Operational impact.** Nightly encrypted dumps to Backblaze B2; a monthly automated restore test; PostgreSQL
  memory shares the 7.8 GB with MyLuxVacation and the app's `MemoryMax` limits.
- **Reversibility.** Moderate: the ORM layer isolates SQL, but JSON item bodies and full-text search would need
  rework on another engine. Nothing in the design depends on PostgreSQL-only features beyond those two.
- **Open.** When circles hold real scores, whether to add hourly incremental backups (owner, trigger item in the spec).
