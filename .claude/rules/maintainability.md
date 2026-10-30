# Maintainability Rules

No file or method grows unmanageable. **2–3k lines is an outer ceiling on a file, treated as a
defect once approached, not a target to build up to.** In practice almost nothing should get near
it — a file that size is already a sign of too many responsibilities living in one place.

Functions are held to a much tighter bar than the file ceiling. A function should do one thing and be
readable without scrolling past a screen or two. A function anywhere near hundreds of lines is a design
defect: extract it into named, single-purpose functions and, when the grouping is real, into its own module.

## How this applies here

- **The mock-up's compressed style is not the convention going forward.** The original static site packs
  whole components onto single lines. New and rewritten code is formatted normally (one statement per line,
  Prettier defaults) and split by responsibility. Reformat a mock-up file only when you are already changing it.
- **Routes stay thin.** `app/**/route.ts` and `page.tsx` parse input, call a function in `lib/<area>/`, and
  render or respond. Business rules (audience filtering, scoring, consent, quality gates) live in `lib/` with
  unit tests and no Next.js imports, so they test in isolation.
- **One concern per module.** `lib/content/`, `lib/accounts/`, `lib/circles/`, `lib/moderation/`,
  `lib/agents/` (the API side), `agents/` (the Claude Code side). A new concern gets a new module, not a new
  function on an existing one.
- **Components are small.** A page composes focused components; a repeated pattern moves to `components/`.
- **Scripts and provisioning** under `deploy/` and `scripts/` are one job per file with a header comment
  saying what it does and how it is verified.
- Reviewers flag a file or function approaching the ceiling as a finding, not wait for it to be crossed.

Related: `.claude/rules/definition-of-done.md`.
