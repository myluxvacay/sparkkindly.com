# Database Rules

- One PostgreSQL database per environment (`sparkkindly`, `sparkkindly_staging`); only the web app and worker write it.
  Agents go through `/api/agent/*`. Nothing reads or writes MyLuxVacation's MongoDB.
- Parameterize SQL; use the project's ORM/query builder, never string-built queries.
- Use explicit transactions for multi-step atomic changes (scoring, consent state changes, deletions).
- Migrations are expand-then-contract so the previous release still runs against the new schema; the deploy runs them
  through `migrate.sh` and rollback is the previous release directory.
- Define rollback for destructive schema/data changes before applying them.
- Verify migration compatibility and indexes for new query patterns on staging first.
- For UPDATE/DELETE data corrections on real data: back up the exact scope first (`pg_dump -t` or a scoped `COPY`),
  verify the backup, then change, then verify; keep the rollback script.
- Account and child-profile deletion must remove every row the data inventory lists; test it.
