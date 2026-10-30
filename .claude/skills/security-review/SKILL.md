---
name: security-review
description: "Review changed security risks when requested or selected by the AGENTS.md task tier."
---

# Security Review

Inspect the exact diff and reachable changed paths for applicable authorization, data-isolation and child-safety,
injection, secrets, logging, storage, dependency, configuration, server-hardening and abuse risks.
Return evidence-backed findings with severity, file/line, failure scenario and verification, using
`.claude/templates/security-review.md` when a record is wanted.
Standard work covers these within its consolidated review. High-risk work requires independent verification as in AGENTS.md.
Do not launch additional reviewers or expand to a whole-repository audit without a concrete need.
