---
name: fix-bug
description: "Reproduce a behavior defect, fix its root cause and verify the regression at the AGENTS.md review depth."
---

# Fix Bug

1. Establish expected behavior (spec, plan or test) and reproduce the failure with evidence, on staging or locally, never production.
2. Trace the root cause; check every caller of the function you are about to change; add a meaningful failing regression test where applicable.
3. Make the smallest correct fix where all callers route through, and verify the regression plus affected neighbors.
4. Apply the AGENTS.md tier. Update support documentation only when an ongoing support need changes.
Report remaining gates; routine bug fixes do not require deployment-readiness work.
