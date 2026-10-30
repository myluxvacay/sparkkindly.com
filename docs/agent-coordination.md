# Agent coordination

For any agent (Claude Code, Codex or another) working in this repository alongside others.

**Task board.** `docs/superpowers/plans/2026-10-30-roadmap-tracker.md`. Work only on a task assigned to you by the
owner or by the plan you were handed; mark it `[~]` when you start and `[x]` with a one-line evidence pointer when
done. Do not pick up neighbouring tasks because they look related.

**Shared resources.**
- The VM is shared with MyLuxVacation. Never change its services, Caddy blocks, MongoDB or the firewall.
- The staging environment (`staging.sparkkindly.com`, port 3101, database `sparkkindly_staging`) is the only place
  for shared-state tests, migration rehearsals and agent dry runs. Say in the tracker when you are using it for
  something another agent must not interrupt (a migration rehearsal, a load test).
- Production (`sparkkindly`, port 3100) changes only through the deploy pipeline on push to `main`, or through a
  documented procedure in `docs/OPERATIONS.md` that the owner has authorized for that occasion.
- The owner's Claude subscription is shared between interactive sessions and the scheduled content agents. Do not
  start large unattended runs without checking the day's agent schedule.

**Branches.** `main` deploys to production; `staging` deploys to staging. Feature work happens on short-lived
branches merged to `staging` first. Nobody pushes without the owner's authorization.

**Hand-offs.** When stopping mid-task, leave the tracker entry and, if the task is long, a short note in the plan
file (what is done, what is verified, what is next). Do not leave uncommitted changes on the VM.
