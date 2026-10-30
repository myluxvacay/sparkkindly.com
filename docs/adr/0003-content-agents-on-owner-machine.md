# 0003 — Content agents run as scheduled Claude Code tasks on the owner's machine

**Status:** Accepted · 2026-10-30

## Context

The platform's content is produced by AI agents: one per world, a reviewer, a promotion agent, a moderation agent,
all run by a master. The owner does not want a separate AI API account or per-request AI costs; they have a Claude
Pro subscription (upgradeable to Max) and want the agents to run under it, on their Windows machine, as scheduled
tasks. The site itself must never depend on the agents being up.

## Decision

The agents live in the repository under `agents/` and run via Windows Task Scheduler invoking `claude -p` with the
`/daily-run` command, as several small runs a day sized to the Pro plan. They talk to the site only through
`/api/agent/*` with a per-agent key. The site publishes from a buffer of scheduled items (3 days per world), so a
day without agent runs shows no gap. Usage is measured in the first week before the full schedule is enabled, and
the digest recommends a plan upgrade when buffers are missed on 3 of 7 days. The site has no AI dependency of its
own.

## Consequences

- **Positive.** No API bill; the site is a conventional web app that runs without the agents; the agent side can be
  rebuilt or moved without touching the site; adding a world is a row, a goals file and a key.
- **Negative.** Content production depends on the owner's machine being on and signed in; plan rate limits cap
  throughput; scheduled headless use must be confirmed against Anthropic's current subscription terms before Project
  2 goes live (recorded as a task).
- **Security / Privacy.** Agent keys are scoped to one agent's items; keys live only in the owner's machine's task
  configuration and the server's hashed store; fetched sources are treated as untrusted data (indirect prompt
  injection), per `.claude/rules/ai-governance.md`.
- **Operational impact.** A heartbeat from the master to the API, alerted after 36 hours of silence; the digest
  reports buffer days and limit hits; the owner's machine becomes an operational dependency worth a UPS and
  automatic sign-in on reboot.
- **Reversibility.** Good: the contract is the API and item format, so a VM-hosted agent runner on an API key is a
  drop-in replacement if the owner ever chooses that (an owner decision, with a hard monthly cap).
- **Open.** Who the named backup is for Kids approvals when the owner is away (owner, before Project 2 goes live).
