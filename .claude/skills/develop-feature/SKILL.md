---
name: develop-feature
description: "Implement a scoped feature using the AGENTS.md task tier and affected verification."
---

# Develop Feature

1. Identify acceptance criteria (the plan task or spec done-when) and relevant existing conventions; plan only as much as needed.
2. Implement the smallest coherent behavior change with meaningful tests (Vitest for logic, Playwright for flows).
3. Run affected builds/tests and relevant consumer checks.
4. Apply the AGENTS.md review tier; fix findings and recheck affected scenarios.
5. Update documentation only where meaning changed; tick the tracker; report actual results and pending merge/release gates.
Create ADRs or threat-model updates only for material decisions or changed threats. No automatic specialist, KB or deployment sequence.
