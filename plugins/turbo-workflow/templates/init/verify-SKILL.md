---
name: verify
description: Use when a code change in {{dir}} ({{name}}) is finished or about to be called done, fixed, or passing; before committing, pushing, or opening a GitHub PR; or when the user asks to verify, check, or prove the work.
---

# Verify {{name}} changes

**Done is the gates run and observed, with the results stated explicitly.** A green test run alone is not done: a weakened test passes by design, so the diff must be read too.

## Procedure

Run from `{{dir}}/`.

1. **Gates.** Run every gate, even if one fails, and read each output.

   ```bash
   {{lint}}          # no --fix: observe, don't rewrite
   {{formatCheck}}   # no --write: observe, don't rewrite
   {{build}}
   {{test}}
   ```

   Inside the turbo-workflow, replace the `{{test}}` line with the app's `coverage` command from `{{root}}/.claude/workflow.json`, so the unit tests run once per verify run, then write the test report (the turbo-workflow rule 7).

2. **E2E.** {{e2e}}

3. **Read the diff.** Use `git diff BASE`, where `BASE` is the base commit (in `/turbo-workflow:work-ticket`, the plan's), the commit before your first one, or `HEAD` when nothing is committed. Run `git status --short` too, and read untracked files in full. Check:
   - **Scope:** every hunk was requested, and nothing outside the task changed.
   - **Test integrity:** no `.skip`, `.only` or `.todo` added; no `expect(` removed; no loosened matcher; no expected value edited to match new output; no test deleted; no test config narrowed.
   - **Suppressions:** no `@ts-ignore`, `eslint-disable`, `console.log` or `debugger` added.
   - **Conventions:** `.claude/rules/coding.md` and `.claude/rules/testing.md` of this app.

4. **Fix and rerun.** On any failure or checklist hit, fix the cause, then rerun all gates. Never get to green with `--no-verify`, `.skip` / `.only`, a narrower test include, `eslint-disable` / `@ts-ignore`, or expected values edited to match new output.

5. **Report.** Every row comes from runs made after your last edit.

   ```markdown
   ## Verification
   | Gate | Result | Evidence |
   | --- | --- | --- |
   | Lint | PASS | <errors, warnings> |
   | Format | PASS | <tool output> |
   | Build | PASS | <exit code> |
   | Unit tests | PASS | <files, tests passed> |
   | E2E tests | SKIPPED | <reason> |
   | Diff review | PASS | <files, in scope> |
   | Test integrity | PASS | <no skipped tests, no assertions removed> |

   **Verdict: PASS** — <one line on what was verified>
   ```

   A `SKIPPED` row always has a reason; any `FAIL` makes the verdict `FAIL`.
