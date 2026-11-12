<!-- Title: one Conventional Commits subject, e.g. `fix: treat empty page query param as unset`. -->

**Ticket:** <!-- the tracker adapter's prLine; delete this line when it is empty -->

## Summary

<!-- 1–3 sentences: what was wrong or missing, and what this PR does. Body under 200 words, tables not counted. -->

## Changes

<!-- One bullet per change. Name only files that are in the diff. -->

-

## Before / after

<!-- One row per behaviour this PR changes; write every Case cell in the same format. -->

| Case | Before | After |
| --- | --- | --- |
|  |  |  |

## Screenshots

<!-- Only when the PR changes UI files (an app's `ui` globs in .claude/workflow.json, test files excluded: `*.test.*`, `*.spec.*` and `**/__tests__/**`); otherwise delete this section. Images live in screenshot.dir of .claude/workflow.json (default docs/images/<feature-name>/) as <screen>-before.<ext> and <screen>-after.<ext>, committed with the code, and are embedded as ![<screen> after](https://github.com/<owner>/<repo>/blob/<commit sha>/<screenshot dir>/<screen>-after.<ext>?raw=true). One row per screen of the plan's `## Screens` (without one, per changed screen); a missing image's cell is `No image: image missing`. Never use images for test results. -->

| Screen | Before | After |
| --- | --- | --- |
|  |  |  |

## How to test

<!-- Commands a reviewer runs, then the verify result of the last run: one table per changed app (<plugin>/skills/work-ticket/workflow.md rule 0): repeat the table below for each one, replacing {{app}} with the app name, with the gate rows of that app's verify report: drop a row the app's verify skill does not run (Type check). An app with "e2e": false in .claude/workflow.json shows E2E tests as n/a. -->

**{{app}}**

| Gate | Result |
| --- | --- |
| Lint |  |
| Format |  |
| Type check |  |
| Build |  |
| Unit tests |  |
| E2E tests |  |

<!-- No changed app (only Claude config, Markdown, root config, .github/, docs/ or root files outside `shared` in .claude/workflow.json changed): replace the tables with the plan checks from test-report.md:

| Check | Command or steps | Result |
| --- | --- | --- |
|  |  |  |

With no spec dir, use one row instead: | Verify | Not applicable: no app code changed |. With a spec dir whose test-report.md has no Plan checks section yet: Plan checks not run.

Requirements shown as `PASS (screenshot, manual)`, `PASS (UAT)`, `PASS (plan check)` or `Not verified` with a `No screenshot:` reason in report.md go in their own list here, apart from the test results. -->

<!-- Optional, for failing or unusual runs: the test runner's summary lines as text.
<details><summary>Test output</summary>

    <test runner summary lines>

</details>
-->

## UAT sign-off

<!-- From report.md's `## UAT`; delete this section when report.md has none. The status line, then one unticked checkbox per scenario with its result and assertion, then the three human checks. A human ticks them; nothing waits on them. Text only: no UAT screenshots. -->

UAT: <!-- passed | failed | failed (AC<n> disputed: <reason>) | not run (<reason>) -->

- [ ] <!-- S1 (AC1): PASS — <assertion> -->
- [ ] Copy reads right
- [ ] Layout looks right
- [ ] The flow feels right

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
