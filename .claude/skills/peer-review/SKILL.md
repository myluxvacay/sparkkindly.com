---
name: peer-review
description: "Perform independent review when the AGENTS.md High-risk tier requires it or the owner requests it."
---

# Peer Review

Give the reviewer the requirement, fixed diff, relevant paths and verification commands without the author's reasoning transcript.
Review changed paths and their reachable effects; require file/line evidence and a concrete failure scenario.
Share routine suite logs tied to the exact state. Independently verify critical/high fixes and the highest-risk scenarios.
Keep reviewers read-only; isolate mutation experiments on staging or locally.
Resolve disagreements by evidence. Re-review only changed risk or unresolved findings; no automatic coordinator round.
Identify the reviewer and independence limits (a fresh-context subagent on the same model is weaker than a separate system).
If unavailable, report the required gate pending. Record using `.claude/templates/peer-review.md` when the owner wants a record.
