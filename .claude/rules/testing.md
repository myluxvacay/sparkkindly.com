# Testing

Follow `AGENTS.md` for tier selection and test scope: the suites the change impacts by default; a comprehensive run only when the owner asks.
Use existing test frameworks (Vitest for unit, Playwright with axe for e2e) and approved acceptance criteria; flag
contradictions rather than changing behavior for an invalid test.

- Behavior bug: reproduce, add a useful failing regression test, fix the cause, run that test and affected neighbors.
- Feature: define observable behavior, add meaningful tests, implement, then check affected consumers.
- Refactor: run existing affected tests; add coverage only for a real gap.
- Prose/policy: relevant links, frontmatter and consistency checks. No invented application tests.
- Shared code (`lib/`): broaden to its consumers and relevant contract/schema tests.
- High-risk: test the changed boundary, including applicable negative, cross-scope (see `data-isolation.md`),
  concurrency and rollback scenarios.
- Server scripts (`deploy/`): the verification commands and expected output in the plan are the test; record them.

Reuse valid results for unchanged code/config/environment. Re-run invalidated checks, not every command after every edit.
Do not weaken, skip or delete legitimate tests to achieve green results. The existing e2e privacy test (no third-party
requests, no storage identifiers on Kids pages) and the accessibility test are gates, never to be relaxed.

## UI verification

For affected UI behavior, use existing representative fixtures covering relevant empty, populated, error or boundary states.
Seed new data only where coverage is missing. Check the running UI visually at 320px and desktop widths and test relevant
keyboard/focus/semantic behavior; automated assertions alone do not establish usability or accessibility. Report what was
exercised and any limitations.
