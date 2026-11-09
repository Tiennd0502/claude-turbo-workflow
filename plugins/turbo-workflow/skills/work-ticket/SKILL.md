---
name: work-ticket
description: End-to-end workflow for one ticket — discuss, plan, branch, implement, review, verify, commit, open a GitHub PR, update the ticket in the project's tracker. Run only when the user invokes /turbo-workflow:work-ticket.
argument-hint: <ticket URL | "task text" | task.md | spec dir> [base branch] | <ticket> done
disable-model-invocation: true
---

# Work a ticket end to end

Arguments: `$ARGUMENTS` — a ticket (a tracker URL, a task text in quotes, or a Markdown file), or a spec dir to resume, optionally a base branch (default `git.baseBranch`); or `<ticket> done`.

**Setup, before anything else.**
- Read the config: `node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get tracker.type`, `get specsDir`, `get git.baseBranch`. A missing or invalid config prints one line: show it, tell the user to run `/turbo-workflow:init`, and stop.
- Read `${CLAUDE_PLUGIN_ROOT}/trackers/<tracker.type>/adapter.md`. Its operations — `parse`, `read`, `move`, `prLine`, done-on-merge — are the only way this skill touches the tracker. The workflow states are `todo`, `inProgress`, `review` and `done`; the adapter maps them to the tracker.
- The workflow rules are `${CLAUDE_SKILL_DIR}/workflow.md`<!-- plugin-only --> (`<plugin>` there is `${CLAUDE_PLUGIN_ROOT}`)<!-- /plugin-only --><!-- copy: rules-autoload -->; `<specsDir>` below is the config's `specsDir`.

If the arguments end in `done`, go to `done`. Otherwise start at step 0.

Follow `${CLAUDE_SKILL_DIR}/workflow.md` for every superpowers step; it overrides their save paths, plan header and commit steps. Review, verify and finishing follow the repo's own rules 7–11, not superpowers skills. Run commands from the repo root; app commands (verify, coverage) from each changed app's dir (workflow rule 0).

**Ticket lookup** (step 0 and `done`): an argument that is a spec dir (it holds `design.md`) is the spec itself. Otherwise take the adapter's `parse(<argument>)`: a ticket id and its canonical ref. Run `grep -lE '^(- )?\*\*(Ticket|Card):\*\*.*<id>([/)]|$)' <specsDir>/*/*/design.md`. It matches only a design's Ticket line (`**Card:**` in designs written before tickets), not a design that merely links the ticket. More than one match → ask the user which one, newest first. A glob error (no design exists yet) counts as not found.

## Gates and notifications

- Every question in the run (brainstorming clarifications, builder check, gates, branch name, choosing between designs) is asked with AskUserQuestion. Questions asked together share one call, at most 4.
  - Option A goes first, labelled "(Recommended)".
  - Then B, and C only when a real third option exists.
  - D is the tool's "Other" field, for the user's own input.
  - Wait for the answer.
- A 🛑 **Gate** is a question whose options name exactly what will happen. Without approval, stop.
- After Gate 1, the run goes on without a gate: the commit (step 9), the amend of a security fix (step 10), the push and the draft PR (step 11) are approved by Gate 1. Moving the ticket is approved by invoking `/turbo-workflow:work-ticket`:
  - step 1 moves it from `todo` to `inProgress`;
  - step 12 moves it to `review` right after the PR is created;
  - the adapter's done-on-merge moves it to `done` when the PR is merged;
  - `done` moves it from `review` to `done` if done-on-merge did not.
  Any other tracker write needs a gate. With an adapter whose `move` does nothing (`none`), these steps are skipped.
- At every gate, and whenever a step fails and you stop, call `PushNotification` first with one line saying what is needed: `work-ticket <ticket label>: <step>: <what you need>` (under 200 chars). On completion, send one with the PR and ticket result. No notifications for other questions or routine progress.
- All tracker work goes through the adapter, as its sections say. Pass write approvals explicitly: ticket + target state.

## Saved status

From step 2 on, the ticket's status lives in `<spec dir>/state.json` (workflow rule 1), and only `node "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-state.mjs" <command> <spec dir> …` writes it (usage in the script's header). A resume reads it instead of the spec files.

- Bookkeeping rides along with work: chain each command onto the step's own Bash call (`… && node "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-state.mjs" at <spec dir> 3 2`); give it a call of its own only when the step has no command.
- `flow <step>` at the start of each step and gate (`2 3 gate1 5 6 7 8 9 10 11 12`). Steps 7 and 8 called from step 10 run no `flow`: the run stays at `10`.
- Before every AskUserQuestion once `state.json` exists: pipe the exact tool input as JSON into `await <spec dir> <gate>` (a heredoc: `await` saves it), ask, then `answered` right after the answer.
- With no `state.json` (a spec started before it existed), every command does nothing and exits 0.

## Steps

0. **Pre-flight.** Run the ticket lookup. Found → go to Resume. Not found: if `git status --short` shows changes, stop and report them; otherwise `git checkout <base> && git pull`.
1. **Read the ticket.** The adapter's `read`, read-only: title, full description, every checklist with its items, its state, dependencies, and the current state of the related code.
   - Check the ticket's state. `review`, `done` or any state other than `todo` and `inProgress` → do not move it (it may already have a PR or be finished). Notify, report its state and ask: A "Stop" (Recommended) or B "Continue without moving the ticket". With B, step 12 does not move the ticket either.
   - Pick the branch name `<type>/<feature-name>` from the ticket (workflow rule 4). Run `git fetch origin`, then `git branch -a --list '<branch>' 'origin/<branch>'`. Any output → ask for another name.
   - Then, if the ticket is in `todo`, run the adapter's `move(<id>, todo, inProgress)`, without asking. It re-reads the ticket and moves it only if it is still in `todo`; otherwise it reports the current state and you stop and ask. State that the move is the workflow's own, approved by invoking `/turbo-workflow:work-ticket`. Continue only after the move is reported done; if it fails, stop and notify. A ticket already in `inProgress` is not moved.
2. **Discuss → `design.md`.** Invoke `superpowers:brainstorming` with the ticket as the request, applying workflow rules 1–3 and the rule 6 overrides: always a written design, no commit.
   - Save under `<specsDir>/<today>/<feature-name>/`, with the Ticket and Branch header lines. Right after `design.md` is first written, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-state.mjs" init <spec dir> <ticket ref> <branch>` (the ref from `parse`).
   - Turn the ticket's description and checklists into `## Requirements from ticket` (R1…).
   - Discussion table; builder check after every playback.
   - When the user approves the design, add the `**Design approved:**` line.
3. **Plan → `plan.md`.** Invoke `superpowers:writing-plans`, applying rules 4–6: Git section from real git output, `## Ticket requirements` table with every R, `## Risks`, `## Plan checks` when the plan's files give no changed app (rule 4), Global Constraints from the rules of each changed app (rule 5), no commit steps. `writing-plans` ends after saving the plan, with no commit, and does not offer an execution choice; go to Gate 1.
4. 🛑 **Gate 1.** Approve the plan and the branch name. The plan always runs natively with `executing-plans` (step 6).
   - Before asking, show: the `plan.md` path and its task titles; the changed apps from `changed-apps.mjs --files` (or "no changed app" and the plan checks); the branch name; and from the plan's `## Risks` the riskiest task, every `accepted` risk, and the rejected approaches.
   - Options:
     - A "Approve and start" (Recommended): add the Gate 1 row to the Git section (rule 4), then go to step 5. If C changed the design, also set the design's `**Design approved:**` line to today.
     - B "Stop here": nothing else is created; `/turbo-workflow:work-ticket <ticket>` (or the spec dir) later resumes at Gate 1.
     - C "Request changes", with the change in the answer's notes or in D (Other): a change to the plan, the scope, the design or the branch name. Edit `plan.md` (a scope, requirement or design change also updates `design.md` and its Discussion table), show what changed and ask again. A new branch name reruns the step 1 name check, then renames the spec dir and updates the branch and spec-dir paths in the design and plan headers (`**Branch:**`, `**Spec:**`) and the Git section. Run `rename <old spec dir> <new spec dir> <new branch>` before moving the dir.
5. **Branch + coverage baseline.** Using the plan's Git section:
   - `git fetch origin <base>`
   - `git checkout --no-track -b <feature branch> origin/<base>`
   - Update the Git section's Base commit from `HEAD` (rule 4), and record it with `base <spec dir> <commit> <base branch>`.
   - Before touching code, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/changed-apps.mjs" --files <the plan's files>` (workflow rule 0) and capture one `coverage-baseline-<app>.json` per changed app (rule 7). No changed app → no baseline.
   - If the plan has `## Screens`, dispatch the `ui-screenshotter` agent for the before shots now, without asking and before any UI edit. Brief it with phase `before` and every `## Screens` row: `<screen>=<path>`, steps, what it must show, and whether it writes data (approved at Gate 1). Handle its report as in **Screenshot report**.
6. **Implement.** Invoke `superpowers:executing-plans` with the rule 6 overrides; never `subagent-driven-development` here. For each task:
   - TDD: write the AC's test, watch it fail, implement, watch it pass. Run `at <task> <step>` at each step boundary (the script ticks the done steps' checkboxes), chained into the step's command when it has one.
   - Tests pass → `tests-pass`. Then dispatch the `plan-reviewer` subagent in diff mode with the plan path, the spec dir and the task number; it runs `task-diff` itself. It checks that task against its acceptance criteria and that each test the plan names for it asserts the AC.
   - A gap → `review <task> gap <text>`, fix it, and review again before the next task.
   - No gap → `review pass` and the plugin's `task-done` in one Bash call (workflow rule 6: `task-done` only after the review).
   - A deviation from the plan → workflow rule 6. One that changes what Gate 1 approved is a 🛑 **plan-change gate**: stop before making it and ask with the options in rule 6. An "unapproved deviation" from `plan-reviewer` goes to the same gate. Any other deviation is only recorded, in the plan's `## Deviations` before `plan-reviewer` runs, and in the ledger.
   After the last task, run the autofix on the whole change (workflow rule 7: `lint-staged --diff=<base commit> --no-hide-partially-staged`, with `boundary` after every autofix in the same call), run the rebuild precondition (workflow rule 7), then, for each changed app (workflow rule 0), from `apps/<app>/`, run the commands `config.mjs cmd run build` and `cmd run test` print; both must pass before step 7. No changed app → only the autofix runs here.
7. **Code review.** Run the autofix (workflow rule 7; it includes `git add -N` on the untracked files), then invoke the `code-review` skill at `medium`. Per workflow rule 8, name the target (the working tree against the base commit) and the rules files. When it returns, save its findings with `findings <spec dir>`, JSON on stdin (`[{ "id", "summary" }]`, `[]` for none), then `finding fixed|left <id>` as each one is handled, and `round pre` for each round, once when its fix starts. Called from step 10, run no `flow`, and the round is step 10's `round post`. Handle findings per rule 8:
   - A bug or a rules violation → fix, run the related tests and the autofix, then `code-review` on the fix. Round limit: workflow rule 8.
   - A fix that deviates from the plan (workflow rule 6) goes through the plan-change gate first. This also covers the fixes that step 8 and step 10 send back here.
   - A cleanup or a false positive → do not fix; keep one line for `report.md`.
8. **Verify + test report + `report.md`.** Run the autofix again and the rebuild precondition (workflow rule 7), then, for each changed app (workflow rule 0), from `apps/<app>/`, read and run `apps/<app>/.claude/skills/verify/SKILL.md` with the unit gate on the app's `coverage` command from `.claude/workflow.json`, and write `test-report.md` from `${CLAUDE_PLUGIN_ROOT}/templates/test-report.md`, with each app's rows and Coverage block. Every gate must PASS, or be SKIPPED or n/a with a reason. No changed app → run the plan's `## Plan checks` instead and write their results in the report's "Plan checks" section.
   - Verify runs before the after screenshots: a verify build can overwrite the dev server's output (`next build` rewrites `.next`), so start the dev server again for the screenshots.
   - On a failure, the notification names `test-report.md`. A fix that changes logic in `src/` goes back to step 7 for that fix; a test, lint or format fix reruns this step. This overrides the `verify` skill's step 4 ("Fix and rerun") for logic fixes.
   - Round limit: workflow rule 8 (shared with step 7 before the commit); each rerun is a `round pre`. Called from step 10, run no `flow`, and the rerun belongs to step 10's `round post`.
   - When it passes, check that every plan checkbox is `[x]` and every `R<n>` in the design's `## Requirements from ticket` has a row in the plan's `## Ticket requirements` table. Anything open → back to step 6.
   - Then, if the plan has `## Screens`, dispatch the `ui-screenshotter` agent for the after shots, on every run of this step (also from step 10), without asking, with phase `after` and the same rows. Handle its report as in **Screenshot report**.
   - File check: every `## Screens` row needs `<screen>-before.<ext>` and `<screen>-after.<ext>` in `screenshot.dir` of `.claude/workflow.json`. A missing file counts as a failed screen; no new screenshot run.
   - `report.md` lists each failed screen as `No screenshot: <screen>: <before|after|before and after> image missing`: the reason is which image the file check found missing, nothing else.
   - Evidence: every row gets one type from workflow rule 9: `PASS`, `PASS (screenshot, manual)`, `PASS (plan check)` or `Not verified`. An AC without a test, or whose test is in a SKIPPED gate (e.g. an app's e2e skipped by its database guard), is Not verified with the reason, never PASS, and does not send you back to step 6.
   - A row whose evidence is a failed screen is `Not verified`, with that screen's `No screenshot:` line as its reason (one per failed screen); a row proven by a passing test keeps `PASS`.
   - Tick each `R<n>` in the design's `## Requirements from ticket` from this run only: `PASS`, `PASS (screenshot, manual)` or `PASS (plan check)` → ticked; Not verified → unticked, also when an earlier run ticked it. Then write `report.md` (rule 9) with `Security: pending`. A rerun from step 10 keeps the existing Security line and its findings.
   - **Screenshot report** (steps 5 and 8). The agent retries each screen up to 3 times.
     - `DONE` → read the saved files and go on.
     - `FAILED` → no question: the agent deleted each failed screen's image; go on. At step 8 the file check marks those screens.
     - `BLOCKED` → relay what it needs to the user, then continue the same agent with SendMessage.
     - `PARTIAL` → continue it with SendMessage for what is left.
9. **Commit.** Run `git add -A`, then commit with one message per workflow rule 11, without asking. Nothing is changed in the tracker. If a hook fails, fix the cause; never use `--no-verify`.
10. **Security review.** Check `<base commit>..HEAD` against the areas listed in workflow rule 8 (access control, config or secrets, dependencies, and the paths in each app's `security` list in `.claude/workflow.json`). None touched → replace `Security: pending` in `report.md` with `Security: skipped, no security-relevant change` and go to step 11. Otherwise invoke the `security-review` skill:
    - No finding → `Security: no findings`.
    - A finding → fix it, then `code-review` on the fix (step 7), then step 8; that rerun keeps the Security line.
    - Then `git add -A` and `git commit --amend --no-edit`, without asking: nothing is pushed yet.
    - Then rerun `security-review`. Round limit: workflow rule 8 (3 rounds after the commit); each round is one `round post`, run when its fix starts. Finishing a fix that a stopped run left half done is the same round.
    - When it is clean, write `Security: findings fixed` with each finding and its fix.
11. **Push + draft PR.** Follow workflow rule 10, without asking:
    - The `pr-description` skill drafts `pr-description.md`; it is not shown.
    - `git push -u <git.remote> <branch>`, then `gh pr create --draft`, per rule 10.
    - A failed push or `gh pr create` → stop and notify; a resume runs this step again.
12. **Ticket → review.** No gate: right after `gh pr create` succeeds, run the adapter's `move(<id>, inProgress, review)` (skip if B was chosen at step 1). State that the move is the workflow's own, approved by invoking `/turbo-workflow:work-ticket`. If the move fails, stop and notify. After the move, run `close <spec dir>`.
13. **Report.** Send the completion notification, then a short summary with the PR link (a draft: the developer reviews it on GitHub and marks it ready, which starts the project's review automation, if any; never run `gh pr ready`), the ticket (in `review`; the adapter's done-on-merge moves it to `done` when the PR is merged, and if that fails, `/turbo-workflow:work-ticket <ticket> done` is the fallback), and the local paths of `report.md`, `test-report.md`, `pr-description.md`, `design.md` and `plan.md`. The details live in `report.md`; do not repeat them.

## Resume

The spec dir is the directory of the matched `design.md`; every later file is read from and written to it.

**With a saved status** (`state.json` in the spec dir):
1. If its branch is known, `gh pr view <branch> --json state`: `MERGED` → the ticket is finished; report it, suggest `<ticket> done`, and stop. A `gh` error (no GitHub remote, offline) counts as not merged.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-state.mjs" status <spec dir>`. It prints the resume brief (Global Constraints, `## Deviations`, the ledger's rulings, the code review findings and the current task's section), then the status, ending with one `Next:` line.
3. Use only that output and do what `Next:` says. Do not re-read `design.md`, the whole `plan.md` or the report files. At step 6, `executing-plans` resumes as workflow rule 6 says.
   - `ask again: <gate>` → `PushNotification` as at every gate, then ask the saved `awaiting.payload` from `state.json` unchanged.
   - `ask the user: …` → show what differs and ask: A "Continue: the change goes through the plan-change gate" (Recommended) or B "Stop: I sort the changes out myself".
   - `check out <branch>` → `git checkout <branch>`, then run `status` again.
   - `stop: …` → report it and stop.
   - `check the PR …` → `gh pr view <branch>`; a PR exists → step 12 (its move only happens from `inProgress`), then `close`; none → run step 11.
4. Exit 3 (`No saved status`) → use the table below.

**Without a saved status:** re-read the spec files: `design.md`, `plan.md`, `report.md`, `test-report.md` and `pr-description.md`. Do not redo finished steps.

The feature branch is the design's `**Branch:**` line; an older design without `**Branch:**` uses the plan's Feature branch row.

Where to continue (the first matching row wins):

| Found | Continue at |
| --- | --- |
| a feature branch is known and `gh pr view <branch> --json state` shows `MERGED` | the ticket is finished: report it, suggest `<ticket> done`, and stop |
| design without `**Design approved:**` | step 2 (finish the design, ask for approval) |
| approved design, no `plan.md` | step 3 |
| `plan.md` without the Gate 1 row | Gate 1 |
| feature branch missing | step 5 |
| Base commit differs from `git merge-base <feature branch> origin/<base>` (after `git fetch origin <base>`) | finish step 5: set Base commit from that merge-base, then capture the baseline |
| a changed app without a baseline | finish step 5: capture its baseline (workflow rule 7), unless `node "${CLAUDE_PLUGIN_ROOT}/scripts/changed-apps.mjs" <base commit>` already lists that app: its code has changed, so note "no clean baseline" for it instead (rule 7). Classify the changed apps with `node "${CLAUDE_PLUGIN_ROOT}/scripts/changed-apps.mjs" --files <the plan's files>`, not from `git diff`: the diff is empty on a fresh branch and partial mid-work.  No changed app → no baseline needed |
| commits after the base commit, `Security: pending` in `report.md` and uncommitted changes | a security fix in progress: finish step 10 from its step 7 → step 8 → amend |
| feature branch exists | the first unfinished step from the plan checkboxes, `test-report.md`, `report.md`, commits after the base commit (step 9 done), a Security line in `report.md` other than `Security: pending` (step 10 done) and `gh pr view <branch>` (step 11 done). The code review leaves no record: with every checkbox ticked and no `report.md`, continue at step 7 (a finished review may run once more) |

Before continuing, act on git:

| Feature branch | Current state | Action |
| --- | --- | --- |
| does not exist | clean tree | `git checkout <base> && git pull` |
| does not exist | dirty tree | stop and report |
| exists | on it | continue; its uncommitted changes are the work in progress |
| exists | on another branch, clean | `git checkout <feature branch>` |
| exists | on another branch, dirty | stop and report |

## `done`

1. Run the ticket lookup. No match → report and stop. Take the branch and the base from the plan's Git section; with no `plan.md`, take the branch from the design's `**Branch:**` line and the base from the arguments.
2. `gh pr view <branch> --json state,url`. Not merged → report the state and stop.
3. Merged → the adapter's `read` gives the ticket's state. If it is still in `review` (done-on-merge normally moves it), run the adapter's `move(<id>, review, done)`, without asking: the move is the workflow's own, approved by invoking `done`. If the move fails, stop and notify. A ticket in any other state than `review` or `done` (for example one left in place by option B at step 1) is not moved: report its state.
4. Delete the local branch, without asking: invoking `done` on a merged PR approves it, and `git branch -d` refuses a branch with commits that are not merged.
   - On the merged branch with a dirty tree: stop and report.
   - On the merged branch with a clean tree: `git checkout <base> && git pull && git branch -d <branch>`.
   - On any other branch: `git branch -d <branch>`, without leaving the current branch. It checks the branch against its upstream (`origin/<branch>`), so no fetch is needed.
5. A command that refuses → report its output, name the command that would finish the step, and stop; never run a forced command yourself.
6. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-state.mjs" close <spec dir>` (nothing happens for a spec without `state.json`).
