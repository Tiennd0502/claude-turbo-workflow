---
name: uat
description: Check a change against what the ticket asked, in the running app, with a fresh agent that never sees the plan or the code. Use at the UAT step of /turbo-workflow:work-ticket, on /turbo-workflow:uat <spec dir | ticket>, from a turbo-workflow:uat-tester brief, or when the user asks to "UAT" or "accept-test" a ticket.
---

# UAT: test what was asked, not what was built

Scenarios come from the owner's words and are judged by assertions in the real app. The project's values (apps, sign-in, API access) come from `.claude/workflow.json`, as **From the project config** at the end says.

## Sources (blindness)

- **Read only:** the ticket text (inline in your brief; never call the tracker), the approved `design.md` you are handed (its `## Requirements from ticket`, or `## Requirements from card` in a design written before tickets, and the `Answer (user)` and `Decision / impact` columns of `## Discussion`), and `uat-scenarios.md` when the brief gives it.
- **Never read** `plan.md`, `report.md`, `test-report.md`, the diff, tests, `git log`, the app's source code (any app's `dir` from `workflow.json`, and `packages/`), `.superpowers/**`, or any other file under `docs/specs/`. Selectors come from the running page (`browser_snapshot`, `browser_evaluate`), never from source.
- **ACs:** clear ticket ACs, plus the details the design settled (exact message text, a Discussion decision). Vague or title-only ticket → ACs from the design's requirements and Discussion. Ticket and design disagree → test the design (the last thing the user approved) and report the disagreement.

## Steps

1. **Scenarios:**
   - `uat-scenarios.md` given → keep every id and wording; only run and judge the rows again. Write it fresh only when the brief says `design.md` changed after it.
   - Otherwise number the ACs `AC1..n`; write 3 to 8 scenarios, each AC at least once, then up to 3 `negative` or `extra`. Each row names exactly one of an AC id, `negative`, `extra`, `not-browser-checkable` (a log, a config, a migration: it counts toward neither pass nor fail).
   - Name the design requirement each AC checks: `AC2 (R3)`, or `AC4 (—)` for a ticket AC that matches no `R<n>`. A brief with a ticket only (no design) has no `(R<n>)` and no design check.
2. **App:** for each AC pick the app that shows it (an API-only change is tested through the web app). Check it answers; if not, start it in the background and wait. Never start a second one. No app has a URL → stop: `status: done`, `passed_ac: false`, every row `SKIPPED`, and `not_run: no app URL`.
3. **Browser and sign-in:** use the project's screenshot browser (its own profile). In order: a session still in the profile; the project's sign-in steps, clicks only; still signed out, 2FA, captcha or several accounts → `BLOCKED`. Never type, print or write a credential.
4. **Run** each scenario. Its result is an assertion on exact text or a selector, run with `browser_evaluate`; a false assertion is `FAIL`. A screenshot is evidence only, saved to `<spec dir>/uat/<id>.png` (never committed), or to `.superpowers/uat/<ticket id>/<id>.png` (gitignored) with no spec dir. Wait until the page is ready before asserting.
5. **API ACs:** (1) through the web UI that shows the response; (2) no such UI and the project gives API access → `fetch` inside the signed-in page with the token from the project's token expression (never printed or saved; no Swagger "Try it out", which asks for the token in a form); (3) neither → `not-browser-checkable`.
6. **Data:** may create or change data on the local database. Never delete data this run did not create; never trigger payments or outgoing webhooks.
7. **Console:** count the console errors after the last scenario. They are reported, never a failure on their own.
8. **Clean up**, before you report: a `done` run, or a `BLOCKED` the user cannot fix in that window, closes the browser and stops every background task you started (TaskStop). A `BLOCKED` that waits for the user (sign-in) leaves the browser open and the app you started running, so the user can sign in in that window and the caller can continue you; clean up when you finish.

An error of the app or database that will not start is not an AC failure: report `not_run: <reason>` (the caller records `UAT: not run (<reason>)`).

## Report

```
status: done | blocked
blocked_reason: <what stopped you, verbatim, and what the user must do>   (blocked only)
passed_ac: true | false      (true only when every checkable AC row passed)
not_run: <reason>            (empty when the run happened: app or database would not start, no app URL, an error)
scenarios:
- id: <S1>  covers: AC<n> (R<n>|—) | negative | extra | not-browser-checkable
  kind: ac | negative | extra | not-browser-checkable
  result: PASS | FAIL | SKIPPED
  assertion: <the text or selector asserted, and what was seen>
  evidence: <spec dir>/uat/<file>
non_ac_failures: <negative or extra rows that failed>
console_errors: <count>
disagreements: <ticket vs design, or none>
```

Name a failing AC `UAT-AC<n>` (for example `UAT-AC2`): the caller saves it as a finding under that id. With the scenarios newly written, also return them as the content of `uat-scenarios.md`.

## Callers

- **Step 9 of `/turbo-workflow:work-ticket`:** passes the ticket text inline, the `design.md` path and `uat-scenarios.md` (when it exists), and saves the scenarios. A failing AC is fixed through the code review and verify loop, then UAT runs again.
- **By hand:** `/turbo-workflow:uat <spec dir>` writes `## UAT` and `## Needs your review` into the spec's `report.md` (and `uat-scenarios.md` on a first run) and changes no code. `/turbo-workflow:uat <ticket>` with no spec dir takes ACs from the ticket's words only, prints the result in chat and writes no file except that evidence (`.superpowers/uat/<ticket id>/<id>.png`).
- The `turbo-workflow:uat-tester` agent keeps the browser output out of your context. It shares the browser, so don't drive it while it runs.

## From the project config

Skip any field that is not set (`config.mjs get` exits with an error for a missing path: treat that error as "not set"); with no `uat` block this is the generic flow above (a session in the profile, else `BLOCKED`; API ACs through the UI, else `not-browser-checkable`).

- **Apps:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get apps`: every app with a `screenshot.url` and `screenshot.devCommand`, changed or not. Start one from the repo root with its `devCommand`.
- **Browser:** the plugin's MCP server `playwright-screenshot` (tools `mcp__plugin_turbo-workflow_playwright-screenshot__browser_*`).
- **Sign-in:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get uat.signIn`: do these steps, clicks only. A value that asks you to type a credential → `BLOCKED`, ask the user to sign in in that window.
- **API access:** `uat.api.url` (base URL), `uat.api.docs` (paths and shapes), `uat.api.token` (a JS expression run in the signed-in page: code, not a secret), `uat.api.devCommand` (starts an API app that has no `screenshot` block).
