---
name: final-quality-gate
description: "Summarize applicable evidence before a requested commit, merge or release, without repeating valid checks."
---

# Final Quality Gate

Identify the requested gate and task tier from AGENTS.md.
Inspect the final diff and reuse verification only for its matching code/config/environment state.
For code merge readiness, verify the impacted suites on the final code state and required reviews; a comprehensive
run happens only when the owner asks. For release readiness, also use the deployment-readiness procedure.
A commit is not a deployment, but a push to `main` or `staging` is: say so when reporting.
Report tier, outcome, checks, review and remaining risks/gates; omit irrelevant categories.
Required FAIL/PENDING/BLOCKED prevents readiness for that gate. Never claim unrun checks passed.
This skill does not authorize a commit, push or deployment.
