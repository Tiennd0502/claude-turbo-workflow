---
name: ticket-status
description: Show where a /turbo-workflow:work-ticket ticket stopped (flow step, task, task step, files changed since the last boundary, next action, and the PR state at the PR step) without changing or continuing anything. Run only when the user invokes /turbo-workflow:ticket-status.
argument-hint: [spec dir]
disable-model-invocation: true
---

# Show a ticket's saved status

Arguments: `$ARGUMENTS` — optional, a spec dir (`<specsDir>/<date>/<feature>`, `specsDir` from `.claude/workflow.json`).

1. From the repo root, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-state.mjs" status --no-brief`, adding the spec dir when one is given.
   - On a ticket's branch it prints that ticket's status, ending with one `Next:` line.
   - On any other branch it prints one line per ticket in progress, or `No ticket in progress`.
   - Exit 3 (`No saved status`) means the ticket has no usable saved status; say so.
   - Exit 1 with `No .claude/workflow.json: run /turbo-workflow:init` (or another config error): show it as is.
2. Show the output unchanged.
3. Only when its `Next:` line starts with `check the PR` (the ticket is at step 11 or the ticket move), run `gh pr view <branch> --json state,url` with the `Branch:` line's branch, and add one line: `PR: <state> <url>`, or `PR: none` when no PR exists, or `PR: unknown (<gh error>)` when `gh` fails (offline, not logged in). The saved status may lag here: the session can stop between `gh pr create` and `close`.

Read only. Do not run the `Next:` action, edit files, switch branches, touch the tracker, or run any `gh` command other than `gh pr view`. To continue the ticket, the user runs `/turbo-workflow:work-ticket <ticket or spec dir>`.
