# SparkKindly — Claude operating notes

Read [AGENTS.md](../AGENTS.md). It alone defines task tiers, review depth, verification and completion reporting.
Use [current status](../docs/current-status.md) only when project orientation is needed.

- Start directly on clear tasks. Keep context and plans proportional to the change.
- Load only the skills and domain rules relevant to the task. Available specialists are a toolbox, not a mandatory sequence.
- Follow the AGENTS.md tier even if a plugin (superpowers, ponytail or another) suggests a broader default workflow.
  Preserve explicit owner requirements.
- For Standard work, use one consolidated review; for High-risk work, select only the expertise needed for changed risks.
- Share routine test evidence and independently check critical scenarios. No automatic second coordinator round.
- Use targeted search. Keep historical review narratives out of routine prompts. Report a short result with actual evidence.
- Commits carry no AI co-author trailers (see `.claude/rules/git.md`). Do not commit, push or touch the live server
  without the owner's authorization for that action.

## Maintaining local skills

`.claude/skills/` is the canonical skill content. If a Codex-compatible copy is ever added under `.agents/skills/`,
update both in the same change and compare the pair byte-for-byte. Keep skill descriptions consistent with AGENTS.md
tier selection.
