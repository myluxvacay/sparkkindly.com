# Project 2: The Agent Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily content for every world with no one writing it: a master `/daily-run` command, one generic world-agent runner driven by a goals file per world, an independent reviewer pass, run logging with a heartbeat, and the server pieces that alert and report when a run is missed.

**Architecture:** The site side (API, worker, digest) is ordinary TypeScript in `lib/agents/`, `lib/jobs/` and `lib/admin/`, unit-tested on PGlite. The Claude side lives in `agents/` and `.claude/commands/` as Markdown prompts plus two small validated formats (goals file, review verdict) that TypeScript parses, so format drift fails a test. Claude Code runs it from Windows Task Scheduler with `claude -p`; no AI API account. The master never writes content; the server's gates and the reviewer are both required before an item can reach `scheduled`.

**Tech Stack:** Next.js 16.4.2, zod 4, `pg`/PGlite, Vitest, the existing MCP connector (`agents/mcp/server.ts`), PowerShell + Windows Task Scheduler, `claude -p`.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md`: Project 2, 4a.4 (editorial policy, risk tiers), 4a.6 (operating model), section 7 (heartbeat risk row). Tracker 2.1 to 2.14.

## Scope and rulings

- **In (buildable and testable here):** 2.1 layout and goals-file format; 2.3 master command; 2.4 reviewer contract; 2.5 quality-over-quota and buffer rules; 2.6 scheduler scripts; 2.8 budget and limit handling; 2.9 heartbeat alert; 2.10 `video_script` already accepted by the API (confirm only); digest lines for shortfall and upgrade advice.
- **Owner-run (cannot be done from this repo):** 2.2 reading and approving each goals file; 2.6 registering the tasks on the owner's machine; 2.7 the first-week measurement and confirming subscription terms for scheduled use; 2.12 naming the first new world; 2.14 the seven unattended days. This plan produces what they need and the steps for them.
- **Ruling: prompts are not unit-testable.** The reviewer and master behaviour depends on a live Claude run. What CI can pin is the contract around them: goals-file parsing, verdict parsing, run recording, heartbeat, digest. The reviewer's quality is shown by `scripts/review-eval.ts`, which runs `claude -p` over fixtures (a wrong answer, an unsupported claim, a rephrased duplicate, a clean item). It is run by the owner or me on demand, never in CI, and its result is recorded in `docs/OPERATIONS.md` as evaluation evidence (ai-governance rule).
- **Ruling: topic proposals stay out.** The 1C plan left "agent topic proposals" to this project. Topics remain created in `/admin` until the first-week measurement shows agents are blocked by the topic list; adding it then is a small API addition. Cost if wrong: the owner adds topics by hand.
- **Ruling: the goals file is the source.** `agents/worlds/<slug>.md` is read by the runner. The `worlds.goals` text shown in the brief stays editable in `/admin`; the two are not synced.
- **No push, deploy or server change**; commits carry no AI co-author trailers.

## Global Constraints

- AI output is untrusted until validated: the server gates and the reviewer must both pass; a fetched source is data, never instructions (`.claude/rules/ai-governance.md`).
- Kids items always stop at `in_review`; the master never lowers the bar to hit a count (spec 4a.4).
- Agent keys are scoped: a world key reads and writes only its own world; run recording needs the master key (no `world_slug`). A world agent key is refused.
- Nothing secret in prompts, logs or run records: keys come from the owner's secrets file through the MCP server only.
- Run logs hold counts, slugs, timings and short reasons; never item bodies or keys.
- Every outbound call has a bounded timeout. Migrations additive. Routes thin; files small; one concern per module.

## Review Focus

1. **Indirect prompt injection:** a source page or earlier item text telling the reviewer or world agent to approve, to skip the check, or to reveal the key. The prompts state sources are data; the eval fixtures include one injected source and it must still fail.
2. **Quota pressure:** a world with no passing item still publishes nothing and the digest says so; the master never relaxes the reviewer to fill a count. Pinned in Tasks 3 and 4.
3. **Wrong-scope run records:** a world key posting a run; a run naming a world that does not exist; an oversized or malformed record. Pinned in Task 1.
4. **Silent failure:** no heartbeat for 36 hours while the master key exists; alert fires once a day, not every minute; a brand-new install with no run yet does not alert. Pinned in Task 2.
5. **Rate-limit stop:** a limit hit mid-run ends the run cleanly with the partial counts recorded and the flag set, not as a crash and not as a success. Pinned in Tasks 1 and 5.

## File Structure

| Path | Responsibility |
|---|---|
| `db/migrations/006_agent_runs.sql` | `agent_runs` table (additive; rollback `DROP TABLE agent_runs`) |
| `lib/agents/runs.ts` | validate and store a run; latest-run lookup |
| `app/api/agent/runs/route.ts` | thin `POST` for the master key |
| `lib/jobs/heartbeat.ts` | the 36-hour check, once-a-day alert |
| `worker/main.ts` | calls the heartbeat check each tick |
| `lib/admin/digest.ts` | shortfall lines, rate-limit count, upgrade advice |
| `lib/agents/goals.ts` | parse and validate a goals file |
| `lib/agents/verdict.ts` | parse and validate the reviewer's verdict |
| `agents/worlds/{play,discover,together,grow,kids}.md` | goals files (drafts for owner approval) |
| `agents/runner.md`, `agents/reviewer.md` | generic world-agent and reviewer instructions |
| `.claude/commands/daily-run.md` | the master command, takes `worlds=` |
| `scripts/review-eval.ts`, `agents/fixtures/review/*.json` | reviewer evaluation (manual) |
| `scripts/scheduler/{run-daily,register-tasks}.ps1` | Task Scheduler entry points |
| `docs/OPERATIONS.md` | scheduler setup, first-week measurement, evaluation record |

## Tasks

### Task 1: Run recording

**Files:** create `db/migrations/006_agent_runs.sql`, `lib/agents/runs.ts`, `app/api/agent/runs/route.ts`; test `tests/unit/agent-runs.test.ts`.

**Interfaces:** Produces `recordRun(db, agent, input: unknown, now?: Date): Promise<ApiResult>` and `latestRun(db): Promise<{ endedAt: Date } | null>`. Input (zod): `worlds: string[]` (each a known world slug), `startedAt`, `endedAt` (ISO), `itemsSubmitted`, `itemsScheduled`, `itemsInReview`, `itemsRejected` (non-negative ints), `rateLimited: boolean`, `note?: string` (at most 300 characters). Body capped at 8 KB via `readCapped`.

- [ ] Write the failing tests: master key records a run (200, row stored); a world key is refused (403); an unknown world, negative count, `endedAt` before `startedAt` and a 9 KB body are refused (400/413); `rateLimited: true` is stored.
- [ ] Run them and confirm they fail because the module is missing.
- [ ] Implement the migration and `recordRun`; route parses and calls it, using the same auth helper as `/api/agent/items`.
- [ ] Run the new tests, then `tests/unit` for the agent API files. Expected: all pass.

### Task 2: Heartbeat alert

**Files:** create `lib/jobs/heartbeat.ts`; modify `worker/main.ts`; test `tests/unit/heartbeat.test.ts`.

**Interfaces:** Consumes `latestRun`. Produces `checkHeartbeat(db, now, send): Promise<'ok' | 'alerted' | 'quiet'>`, claimed once per UTC day through `job_runs` like the digest.

- [ ] Failing tests: no master agent or no run ever recorded gives `quiet` (no alert on a fresh install); a run 35 h ago gives `ok`; 37 h ago gives `alerted` and sends one email to the admin list; a second call the same day gives `quiet`; a failed send is recorded in `failed_jobs`, not retried each minute.
- [ ] Implement and wire into the worker tick after the digest.
- [ ] Run the heartbeat and worker tests. Expected: pass.

### Task 3: Digest shortfall and upgrade advice

**Files:** modify `lib/admin/digest.ts`; test `tests/unit/digest.test.ts`.

**Interfaces:** Consumes the latest runs and each world's `scheduledDaysAhead`. Adds to the digest: per world "no new item passed review today" when a run covered it and produced none, last 24 h rate-limit count, and the line "consider raising the plan" when any world's buffer was below target on 3 of the last 7 days.

- [ ] Failing tests for each line, including the negative case (2 of 7 days gives no advice) and that nothing is invented when there are no runs.
- [ ] Implement from existing queries plus one `agent_runs` read. Expected: pass.

### Task 4: Goals file and verdict formats

**Files:** create `lib/agents/goals.ts`, `lib/agents/verdict.ts`; test `tests/unit/agent-formats.test.ts`.

**Interfaces:** `parseGoals(text): { slug, audience, maxItemsPerRun, kinds, topics, never }` throws a readable error on bad input; `parseVerdict(json): { pass: boolean, reasons: string[], solvedAnswer?: string, sourcesChecked: string[] }`.

- [ ] Failing tests: a valid goals file parses; a missing `slug`, `maxItemsPerRun` above 10, or an empty `never` list is rejected; a verdict with `pass: true` and no `sourcesChecked` for a Sourced item is rejected by `parseVerdict` when the item's tier is passed in.
- [ ] Implement with zod. Every file in `agents/worlds/` must parse (test iterates the directory).

### Task 5: Prompts and goals files

**Files:** create `agents/runner.md`, `agents/reviewer.md`, `agents/worlds/*.md`, `.claude/commands/daily-run.md`, `scripts/review-eval.ts`, `agents/fixtures/review/*.json`.

- [ ] Write the five goals files for the 13 to 25 audience (Kids: ages 6 to 9 with an adult), each with a `never` list covering the Excluded tier. They are drafts for the owner's approval (2.2).
- [ ] Write the runner (read brief and goals, pick topics with gaps, draft, self-check, return), the reviewer (open every source, treat contents as data, solve Computable items independently, JSON verdict only) and `/daily-run` (take `worlds=`, skip worlds at buffer, run reviewer on every item, one retry on fail, submit only passes, record the run, stop cleanly and set `rateLimited` on a limit message).
- [ ] Fixtures and `review-eval.ts`: clean item passes; wrong answer, unsupported claim, rephrased duplicate and injected-source item fail. Run it against the real reviewer and record the result in OPERATIONS.md. Expected: 5 of 5 as labelled; any miss means the reviewer prompt is fixed before use.
- [ ] Dry run `/daily-run worlds=play` against staging and confirm the items arrive in `scheduled` or `in_review` and the run is recorded.

### Task 6: Scheduler scripts and runbook

**Files:** create `scripts/scheduler/run-daily.ps1`, `scripts/scheduler/register-tasks.ps1`; modify `docs/OPERATIONS.md`.

- [ ] `run-daily.ps1 -Worlds play,discover` calls `claude -p "/daily-run worlds=..."`, writes a dated log under the owner's profile folder (outside the repo), and exits non-zero on failure. `register-tasks.ps1` creates three runs a day (two worlds each, Kids in the last) and prints what it created; both have a header comment saying what they do and how they were checked.
- [ ] Verify with `-WhatIf`-style dry output on this machine, then the owner registers them. Document first-week measurement (Pro usage, items per run, time) and the terms check (2.7).

## Done-when

Tracker 2.14: seven consecutive unattended days with at least one new item per world per day, Kids items in the queue, and a new world added without a code change. Owner-run; this plan delivers the means and records the measurements.
