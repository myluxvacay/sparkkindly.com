---
name: create-test-cases
description: "Create a formal test matrix when requested or when complex acceptance criteria need traceability."
---

# Create Test Cases

Prefer automated tests and existing acceptance criteria for routine changes.
For a formal matrix, use `.claude/templates/test-case.md`, preserve existing IDs and include requirement,
setup/data, steps, expected result and evidence.
Cover relevant positive, negative, boundary, age-group/isolation, concurrency and failure behavior; omit inapplicable dimensions.
Do not duplicate automated test code as prose or invent an artifact for every small edit. Follow AGENTS.md verification scope.
