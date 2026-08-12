You are auditing [AREA] of this repository.

READ-ONLY ONLY.
Do not modify files, packages, configuration, environment files, or node_modules.

Your goal is to produce a concise engineering audit that will be used later to build a single implementation roadmap.

Do NOT repeat the same finding in multiple sections.
Do NOT document every file or every normal code path.
Do NOT speculate unless clearly labeled as a hypothesis.
Focus only on findings that can affect architecture, security, reliability, maintainability, compatibility, performance, or production readiness.

For every finding provide:
- ID
- Severity: P0 / P1 / P2 / P3 / INFO
- Exact file + line/function
- Evidence
- Why it matters
- Recommended action: KEEP / FIX / REFACTOR / REWRITE / REMOVE / DEFER

Required output:

# [AREA] Audit

## 1. Executive Summary
Maximum 10 bullets.
Include overall verdict.

## 2. Architecture / Runtime Flow
Maximum 15 lines.
Only describe the flow necessary to understand findings.

## 3. Findings
Use a table:

| ID  | Severity | Location | Finding | Impact | Action |
| --- | -------- | -------- | ------- | ------ | ------ |

Maximum 15 findings.
Merge duplicate findings.

## 4. Important Evidence
Only include code snippets/configuration that are necessary to prove P0/P1/P2 findings.
Maximum 10 snippets.

## 5. Cross-Cutting Risks
Only issues that affect other parts of the system.
Maximum 10 bullets.

## 6. KEEP / FIX / REFACTOR / REWRITE / REMOVE / DEFER
List only concrete items.

## 7. Implementation Dependencies
Identify:
- what must be fixed first
- what depends on another change
- what can safely be deferred

## 8. Audit Verdict
Use exactly one:
READY
READY WITH WARNINGS
NOT READY

## 9. Files Likely Affected
List only files likely to change during implementation.

Important:
- Do not create an implementation plan.
- Do not modify anything.
- Do not recommend changes outside the audited area unless they are a direct dependency.
- Do not perform another audit of unrelated subsystems.
- Do not repeat the same issue under different headings.
- Preserve exact file paths, line numbers, versions, and observed behavior.
- Distinguish CONFIRMED findings from POSSIBLE risks.

The final report should be concise enough to review in 5–10 minutes while retaining all information needed for a later implementation roadmap.